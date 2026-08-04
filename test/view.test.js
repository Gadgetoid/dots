// What the view asks the renderer to draw.
//
// The view is the one part of the game with no test that can look at its output, since
// the output is pixels on a GPU. But what it *asks for* is ordinary function calls, and
// the numbers in them can be checked: this drives every screen through a renderer that
// records instead of drawing, and insists that nothing it is handed is a NaN, an
// undefined or a negative size.
//
// That is not a small thing to check. A NaN reaches the vertex positions and the shape
// vanishes without a word - which is exactly how a linked dot came to be invisible, from
// a constant that had been deleted while one line still read it.

import test from "node:test"
import assert from "node:assert/strict"

import { Game, PHASE } from "../src/game.js"
import { GameView } from "../src/view.js"
import { VIEW_W, VIEW_H } from "../src/config.js"
import { GAME_MODES } from "../src/modes/index.js"
import { LEVELS } from "../src/modes/levels.js"
import { PUZZLE_SETS } from "../src/modes/puzzle.js"

// A renderer that writes down what it was told to draw. Every method the contract has,
// so a call the view makes that this does not have is a failure rather than a crash.
class Recorder {
  constructor() {
    this.calls = []
    this.canvas = { width: VIEW_W, height: VIEW_H, getBoundingClientRect: () => ({}) }
    this.brightness = 1
    this.glowIntensity = 1
    this.vignette = 0
  }
  get ready() {
    return true
  }
  #record(kind, args, opts) {
    this.calls.push({ kind, args, opts: opts || {} })
  }
  beginFrame(time) {
    this.#record("beginFrame", [time])
  }
  beginOverlay(opts) {
    this.#record("beginOverlay", [], opts)
  }
  endFrame() {
    this.#record("endFrame", [])
  }
  clearFrame(color) {
    this.#record("clearFrame", [], { color })
  }
  disc(x, y, r, opts) {
    this.#record("disc", [x, y, r], opts)
  }
  ring(x, y, r, opts) {
    this.#record("ring", [x, y, r], opts)
  }
  blobChain(points, opts) {
    this.#record(
      "blobChain",
      points.flatMap((p) => [p.x, p.y, p.grow ?? 1]),
      opts,
    )
  }
  ribbon(points, opts) {
    this.#record(
      "ribbon",
      points.flatMap((p) => [p.x, p.y]),
      opts,
    )
  }
  point(x, y, size, opts) {
    this.#record("point", [x, y, size], opts)
  }
  panel(x, y, w, h, opts) {
    this.#record("panel", [x, y, w, h], opts)
  }
  clip(x, y, w, h) {
    this.#record("clip", [x, y, w, h])
  }
  clipOff() {
    this.#record("clipOff", [])
  }
  text(str, x, y, opts) {
    this.#record("text", [x, y], { ...opts, str })
  }
  measureText(str, size) {
    return str.length * size * 0.6
  }
  setFont(stack) {
    this.fontStack = stack
  }
  setContentRect() {}
}

// Everything numeric the view passed, including the option bags, since a size or an alpha
// in one of those is as capable of being NaN as a coordinate.
function numbersIn(call) {
  const numbers = [...call.args]
  const walk = (value) => {
    if (typeof value === "number") {
      numbers.push(value)
    } else if (value && typeof value === "object") {
      for (const inner of Object.values(value)) {
        walk(inner)
      }
    }
  }
  walk(call.opts)
  return numbers
}

function drawn(game) {
  const renderer = new Recorder()
  const view = new GameView(renderer)
  view.content = { x: 0, y: 0, width: VIEW_W, height: VIEW_H }
  view.render(game)
  return renderer.calls
}

// Every number the view hands over has to be a number. Sizes and radii have to be
// positive too: a radius of zero draws nothing, which is the same failure as a NaN.
function assertSane(calls, where) {
  assert.ok(calls.length > 0, `${where}: something was drawn`)
  for (const call of calls) {
    for (const value of numbersIn(call)) {
      assert.equal(
        Number.isFinite(value),
        true,
        `${where}: ${call.kind} was handed ${value} (${JSON.stringify(call.opts)})`,
      )
    }
    if (call.kind === "disc" || call.kind === "ring" || call.kind === "point") {
      assert.ok(call.args[2] > 0, `${where}: ${call.kind} has a size of ${call.args[2]}`)
    }
    if (call.kind === "panel") {
      assert.ok(
        call.args[2] > 0 && call.args[3] > 0,
        `${where}: panel is ${call.args[2]}x${call.args[3]}`,
      )
    }
  }
}

// Nothing a menu draws may fall off the field. A page that has outgrown the screen does
// not fail, it just quietly loses its bottom row - which on the settings page is the way
// out of it - so this is worth insisting on rather than checking by eye every time a row
// or a font size is added.
function assertOnScreen(calls, where) {
  // Anything drawn inside a clip is confined by the renderer, so it is allowed to be outside
  // the field: that is what a scrolling list is. The level picker's grid is the only one.
  let clipped = false
  for (const call of calls) {
    if (call.kind === "clip") {
      clipped = true
      continue
    }
    if (call.kind === "clipOff") {
      clipped = false
      continue
    }
    if (clipped) {
      continue
    }
    if (call.kind === "text") {
      const [, y] = call.args
      assert.ok(y >= 0 && y <= VIEW_H, `${where}: "${call.opts.str}" is at y=${Math.round(y)}`)
      continue
    }
    if (call.kind !== "panel") {
      continue
    }
    const [, y, , h] = call.args
    // The full-window frost is exactly the field, so its own edges are allowed to be on it.
    if (h >= VIEW_H) {
      continue
    }
    assert.ok(y >= 0, `${where}: a panel starts at y=${Math.round(y)}`)
    assert.ok(y + h <= VIEW_H, `${where}: a panel ends at y=${Math.round(y + h)}`)
  }
}

// resize() asks the window how dense the display is.
globalThis.window = globalThis.window || { devicePixelRatio: 1 }

const FRAME = 1 / 60
const settle = (game, seconds = 4) => {
  for (let i = 0; i < seconds * 60; i++) {
    game.advance(FRAME)
  }
}

test("the title screen draws", () => {
  const game = new Game()
  settle(game, 1)
  assertSane(drawn(game), "title")
})

test("every mode's board draws, dealt and settled", () => {
  for (const mode of GAME_MODES) {
    const game = new Game()
    game.start(mode.id)
    assertSane(drawn(game), `${mode.id} mid-deal`)
    settle(game)
    assertSane(drawn(game), `${mode.id} settled`)
  }
})

test("a dot held on its own is drawn", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const dot = game.board.dots.find((entry) => entry.row === game.board.rows - 1)
  game.player.cursor = { col: dot.col, row: dot.row }
  assert.equal(game.startChain(0), true)
  settle(game, 0.5)

  const calls = drawn(game)
  assertSane(calls, "one dot held")
  // The chain itself is not drawn until there are two of them, so the dot is the only
  // thing marking what is held: if it is missing, a player has picked up nothing.
  const at = game.dotPosition(dot)
  const found = calls.some(
    (call) =>
      call.kind === "disc" &&
      Math.abs(call.args[0] - at.x) < 0.01 &&
      Math.abs(call.args[1] - at.y) < 0.01 &&
      call.args[2] > 0,
  )
  assert.ok(found, "the held dot was drawn")
  assert.equal(game.player.chain.length, 1)
})

test("a chain of several draws as one body", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const chain = game.board.longestChain()
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  game.startChain(0)
  for (let i = 1; i < chain.length; i++) {
    game.extendTo(0, chain[i].col, chain[i].row)
  }
  settle(game, 0.3)

  const calls = drawn(game)
  assertSane(calls, "chain held")
  const blob = calls.find((call) => call.kind === "blobChain")
  assert.ok(blob, "the chain was drawn")
  assert.ok(blob.opts.radius > 0 && blob.opts.cord > 0, "with a body to it")
})

test("a chain being spent draws, and so does the score it leaves", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const chain = game.board.longestChain()
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  game.startChain(0)
  for (let i = 1; i < chain.length; i++) {
    game.extendTo(0, chain[i].col, chain[i].row)
  }
  game.popChain(0)
  for (let i = 0; i < 12; i++) {
    game.advance(FRAME)
    assertSane(drawn(game), "mid-pop")
  }
})

test("with shapes on, every dot is drawn with one", () => {
  const game = new Game()
  game.settings.shapes = "on"
  game.start("classic")
  settle(game)
  const calls = drawn(game)
  assertSane(calls, "shapes on")

  // Every dot on the board, and nothing else, asks for a shape. The faint markers in the
  // empty cells are not dots and the particles are not either.
  const shaped = calls.filter((call) => call.kind === "disc" && call.opts.shape)
  assert.equal(shaped.length, game.board.count, "one shaped disc per dot")
  for (const call of shaped) {
    assert.ok(call.opts.shape.sides >= 0, "with a side count")
  }

  const off = new Game()
  off.start("classic")
  settle(off)
  assert.equal(
    drawn(off).some((call) => call.kind === "disc" && call.opts.shape),
    false,
    "and none at all with the setting off",
  )
})

test("a hint draws, wobbling or ringed", () => {
  for (const motion of ["full", "reduced"]) {
    const game = new Game()
    game.settings.motion = motion
    game.start("classic")
    settle(game)
    for (let i = 0; i < 60 * 12 && !game.hint; i++) {
      game.advance(FRAME)
    }
    assert.ok(game.hint, `${motion}: the board pointed at something`)
    assertSane(drawn(game), `${motion} hint`)
  }
})

test("every menu page draws, on both themes", () => {
  for (const theme of ["dark", "light"]) {
    const game = new Game()
    game.settings.theme = theme
    settle(game, 1)
    assertSane(drawn(game), `${theme} title`)

    // Down through every page the menus can reach.
    game.menuTap(0) // new game
    assert.equal(game.page, "modes")
    assertSane(drawn(game), `${theme} modes`)

    game.start("puzzle")
    settle(game)
    game.togglePause()
    assertSane(drawn(game), `${theme} pause`)

    const settings = game
      .menuRows()
      .findIndex(
        (row) =>
          row.kind === "buttons" && row.options.some((cell) => cell && cell.action === "settings"),
      )
    game.menuTap(settings, 1)
    assert.equal(game.page, "settings")
    assertSane(drawn(game), `${theme} settings`)

    const controls = game
      .menuRows()
      .findIndex(
        (row) =>
          row.kind === "buttons" && row.options.some((cell) => cell && cell.action === "controls"),
      )
    game.menuTap(controls, 1)
    assert.equal(game.page, "controls")
    assertSane(drawn(game), `${theme} controls`)
    // And a row waiting for a key, which draws its own prompt.
    game.rebinding = { device: "keys", control: "link" }
    assertSane(drawn(game), `${theme} rebinding`)
  }
})

test("the game-over screen draws, won and lost", () => {
  const lost = new Game()
  lost.start("classic")
  settle(lost)
  for (const dot of lost.board.dots) {
    dot.colour = (dot.col + dot.row) % 2
  }
  settle(lost, 3)
  assert.equal(lost.phase, PHASE.OVER)
  assertSane(drawn(lost), "lost")

  const won = new Game()
  won.start("clearout")
  settle(won)
  won.board.remove(won.board.dots.slice())
  settle(won, 2)
  assert.equal(won.outcome, "won")
  assertSane(drawn(won), "won")
})

test("a cleared level draws its page, star earned and star missed", () => {
  const game = new Game()
  game.start("puzzle")
  settle(game)
  game.board.remove(game.board.dots.slice())
  for (let i = 0; i < 60 * 3 && !game.cleared; i++) {
    game.advance(FRAME)
  }
  assert.ok(game.cleared, "there was something to say")
  // A star missed says how far short it fell, since two five-figure numbers side by side do
  // not tell a player whether they were sixteen out or four thousand.
  game.cleared.starred = false
  game.cleared.contested = true
  game.cleared.par = game.cleared.scored + 16
  const shown = drawn(game)
    .filter((call) => call.kind === "text")
    .map((call) => call.opts.str)
  assert.ok(shown.includes("16 short of par"), "the gap is written out")
  // Both marks and the flight between them: the star arrives over about half a second, and
  // a missed one is a different page - a hollow star and a retry beside the way on.
  for (const starred of [true, false]) {
    game.cleared.starred = starred
    game.cleared.contested = true
    for (const age of [0, 0.2, 0.42, 2]) {
      game.cleared.age = age
      assertSane(drawn(game), `level cleared, star ${starred} at ${age}s`)
    }
  }
})

test("a round of turns is marked out of five, and the stars arrive one by one", () => {
  const game = new Game()
  game.start("seeded")
  settle(game)
  game.turns = 30
  game.player.score = 30 * 1296 // a run of sixes, which is four of the five
  assert.equal(game.rank, 4)
  // A star is one shaped disc, and a filled one is the one that carries the glow.
  const filled = (calls) =>
    calls.filter((call) => call.kind === "disc" && call.opts.shape && call.opts.glow > 0).length
  game.page = "over"
  const landed = [0, 0.4, 1.2, 3].map((age) => {
    game.finishedAt = game.time - age
    const calls = drawn(game)
    assertOnScreen(calls, `over, stars at ${age}s`)
    return filled(calls)
  })
  assert.deepEqual(landed, [0, 1, 4, 4], "they arrive one at a time and stop at the rank")
})

test("a level shows its own score, and the run it belongs to apart from it", () => {
  // Par is a level's, so the number beside it has to be the level's too. A running total there
  // has passed par before a move is made by about the fourth level of a ladder, which reads as
  // having beaten it.
  const game = new Game()
  game.progress = { puzzle: { 0: 1, 1: 1 } }
  game.start("puzzle", { level: 2 })
  settle(game)
  game.player.score = 41200
  game.levelStartScore = 38900
  assert.equal(game.shownScore, 2300, "the big number is what this level has paid")

  const shown = drawn(game)
    .filter((call) => call.kind === "text")
    .map((call) => call.opts.str)
  assert.ok(shown.includes("2300"), "and it is on screen")
  assert.ok(shown.includes("41200"), "with the run's total apart from it")
  assert.ok(shown.includes(`par ${game.levelPar}`), "and the target named, not repeated")
  assert.equal(shown.includes(`${game.levelScore} / ${game.levelPar}`), false)

  // A mode without levels has no par, so the big number is the whole of what has been scored.
  const rush = new Game()
  rush.start("rush")
  settle(rush)
  rush.player.score = 9100
  assert.equal(rush.shownScore, 9100)
})

test("the turn gauge draws at every point of a round, and holds its label", () => {
  const game = new Game()
  game.start("seeded")
  settle(game)
  for (const spent of [0, 1, 17, 29, 30]) {
    game.turns = spent
    assertOnScreen(drawn(game), `${game.turnsLeft} turns left`)
  }
})

test("the clock draws at every point of its run", () => {
  const game = new Game()
  game.start("rush")
  settle(game)
  for (const left of [90, 45, 12, 1, 0.2, 0]) {
    game.timeLeft = left
    assertSane(drawn(game), `clock at ${left}`)
  }
})

test("a flicked puzzle list carries on, and a held one stays put", () => {
  const game = new Game()
  game.start("puzzle")
  game.page = "levels"
  const view = new GameView(new Recorder())
  view.content = { x: 0, y: 0, width: VIEW_W, height: VIEW_H }
  const frame = () => {
    game.advance(1 / 60)
    view.render(game)
  }
  // One frame to set the clock and let the cursor pull the grid to where it opens.
  frame()
  const opened = view.levelScroll

  // A finger drags, and the frame it lands in is what says how fast.
  view.dragLevels(90)
  frame()
  const dragged = view.levelScroll
  assert.ok(dragged > opened, "the list follows the finger")

  // Still down, not moving: being held, not thrown.
  frame()
  assert.equal(view.levelScroll, dragged, "a held list stays where it is put")

  // And off it comes.
  view.dragLevels(90)
  frame()
  const thrown = view.levelScroll
  view.releaseLevels()
  frame()
  assert.ok(view.levelScroll > thrown, "the list carries on once the finger is off it")

  // Which slows, rather than running for ever.
  for (let i = 0; i < 120; i++) {
    frame()
  }
  const settled = view.levelScroll
  frame()
  assert.equal(view.levelScroll, settled, "and comes to rest")
})

test("the pause page says which board and what it has paid", () => {
  const puzzle = new Game()
  puzzle.start("puzzle")
  puzzle.togglePause()
  const spoken = puzzle.pageSpeech()
  assert.match(spoken, /^Puzzle\. (?!Puzzle)/, "the mode's name once, not twice")
  assert.match(spoken, new RegExp(puzzle.currentLevel.name), "then the board's own name")
  assert.match(spoken, /Scored 0 of \d+/, "and what it has paid against its par")
  assert.match(spoken, /0 turns/, "and what it has cost")
  // The page shows the same words it says.
  const shown = drawn(puzzle)
    .filter((call) => call.kind === "text")
    .map((call) => call.opts.str)
  assert.ok(shown.includes(puzzle.boardName), "the board is named on the page")
  assert.ok(shown.includes(puzzle.scoreLine), "and so is the score")
  assert.ok(shown.includes(puzzle.turnsLine), "and the turns beside it")

  // Counted and named off the set being played, not off the first one: `mode.levels` is only
  // ever the first set.
  //
  // The two shipped ladders are the same length, so between those the count could be read off
  // either and agree by coincidence. The third is not, which is what makes the total below a real
  // check that it is derived from the ladder being played.
  for (const [at, set] of PUZZLE_SETS.entries()) {
    const game = new Game()
    game.settings.levelSet = at
    game.start("puzzle")
    assert.equal(game.levels, set.levels, `${set.name} is the ladder being played`)
    game.togglePause()
    assert.equal(
      game.boardName,
      `${set.name}: 1 of ${game.levels.length}, ${set.levels[0].name}`,
      `${set.name} counts and names itself`,
    )
    assert.match(
      game.pageSpeech(),
      new RegExp(`${game.modeName}\\. ${set.name}: 1 of`),
      "and says so, with the rules where they are the ladder's own",
    )
  }
  // Which is only worth anything because the sets are genuinely different ladders.
  assert.notEqual(PUZZLE_SETS[1].levels, PUZZLE_SETS[0].levels)

  const seeded = new Game()
  seeded.start("seeded")
  seeded.togglePause()
  assert.match(seeded.pageSpeech(), /Code \d{6}/, "a seeded board is named by its code")

  // A mode that deals its own board has nothing to name, and still says the score.
  const classic = new Game()
  classic.start("classic")
  classic.togglePause()
  assert.equal(classic.boardName, null)
  assert.match(classic.pageSpeech(), /Scored 0/)
  assert.ok(
    drawn(classic)
      .filter((call) => call.kind === "text")
      .map((call) => call.opts.str)
      .includes(classic.mode.blurb),
    "so it says what the mode is instead",
  )
})

test("the banner a first game opens with fits the field", () => {
  const game = new Game()
  // The welcome, in the game's own words: launch with nothing remembered raises it.
  game.launch("")
  assert.ok(game.banner, "a first-time player is told how to play")
  for (const call of drawn(game)) {
    if (call.kind !== "text" || call.opts.align !== "center") {
      continue
    }
    const width = call.opts.str.length * call.opts.size * 0.6
    const [x] = call.args
    assert.ok(
      x - width / 2 >= 0 && x + width / 2 <= VIEW_W,
      `"${call.opts.str}" runs ${Math.round(x - width / 2)}..${Math.round(x + width / 2)} across a field of ${VIEW_W}`,
    )
  }
})

test("every hint fits the panel it is drawn in", () => {
  const game = new Game()
  game.start("classic")
  // The widest hints are the settings, one per value, and the seed picker's.
  for (const page of ["settings", "seed", "modes", "over"]) {
    game.page = page
    const rows = game.menuRows()
    rows.forEach((row, index) => {
      if (row.kind === "heading" || row.kind === "hint") {
        return
      }
      game.menuIndex = index
      const cells = row.kind === "options" ? row.options.length : Math.max(row.options.length, 1)
      for (let option = 0; option < cells; option++) {
        game.menuOption = option
        const calls = drawn(game)
        // Where the panel is, taken from what was drawn in it rather than from a metric the
        // view keeps to itself: every cell of every row sits inside it. Only what is drawn
        // after beginOverlay counts - before it is the board, and the well is wider than the
        // menu that goes over it.
        let overlay = false
        let left = Infinity
        let right = -Infinity
        for (const call of calls) {
          if (call.kind === "beginOverlay") {
            overlay = true
            continue
          }
          if (!overlay || call.kind !== "panel") {
            continue
          }
          const [x, , w] = call.args
          if (w >= VIEW_W) {
            continue // the full-window frost
          }
          left = Math.min(left, x)
          right = Math.max(right, x + w)
        }
        if (!Number.isFinite(left)) {
          continue
        }
        for (const call of calls) {
          if (call.kind !== "text" || call.opts.align !== "center") {
            continue
          }
          const width = call.opts.str.length * call.opts.size * 0.6
          const [x] = call.args
          assert.ok(
            x - width / 2 >= left - 1 && x + width / 2 <= right + 1,
            `${page} row ${index} cell ${option}: "${call.opts.str}" runs ${Math.round(x - width / 2)}..${Math.round(x + width / 2)} in a panel of ${Math.round(left)}..${Math.round(right)}`,
          )
        }
      }
    })
  }
})

test("no menu page runs off the field", () => {
  const game = new Game()
  game.start("puzzle")
  // The two pages that are a held-up result rather than a menu reached by walking to it, so
  // they have something to draw when the loop below puts them up.
  game.cleared = {
    name: game.currentLevel.name,
    scored: 1234,
    par: 2048,
    turns: 7,
    starred: false,
    contested: true,
    last: false,
    age: 0.2,
  }
  game.card = { seed: 12345, score: 40000, turns: 30, stars: 3, age: 1 }
  // Every page, including the two with the most on them: the settings, and the controls
  // with a row per control per device.
  for (const page of [
    "title",
    "modes",
    "levels",
    "pause",
    "over",
    "cleared",
    "card",
    "settings",
    "controls",
    "seed",
  ]) {
    game.page = page
    game.menuIndex = 0
    game.menuOption = 0
    assertOnScreen(drawn(game), page)
    // And with the cursor walked to the end, where the hint and the last row are.
    for (let i = 0; i < 20; i++) {
      game.menuMove(1)
    }
    assertOnScreen(drawn(game), `${page}, cursor at the end`)
  }
})

test("the level picker scrolls past its cursor, as far as the last level", () => {
  // The cursor stops at the last level unlocked, so looking ahead at the rest of the ladder is
  // done with a wheel or a dragging finger. The grid is pulled to the cursor as the cursor moves
  // and not on every frame, or scrolling springs back and the bar never reaches its foot.
  const game = new Game()
  game.start("puzzle")
  game.page = "levels"
  // The grid's own row, since the ladder strip sits above it.
  game.menuIndex = game.menuRows().findIndex((row) => row.id === "levels")
  game.menuOption = 0

  const view = new GameView(new Recorder())
  view.content = { x: 0, y: 0, width: VIEW_W, height: VIEW_H }
  const frame = () => {
    const renderer = new Recorder()
    view.renderer = renderer
    view.render(game)
    return renderer.calls
  }

  frame()
  const atCursor = view.levelScroll
  view.scrollLevels(10000)
  frame()
  assert.ok(view.levelScroll > atCursor, "a wheel scrolls away from the cursor")
  const atEnd = view.levelScroll
  frame()
  assert.equal(view.levelScroll, atEnd, "and the next frame leaves it where it was put")

  // Scrolled to the end, the last level is on screen: the grid is clipped to the row, so what
  // counts is being inside the clip and not inside the field.
  const calls = frame()
  const opened = calls.findIndex((call) => call.kind === "clip")
  const closed = calls.findIndex((call) => call.kind === "clipOff")
  const [, top, , height] = calls[opened].args
  const last = calls
    .slice(opened + 1, closed)
    .find((call) => call.kind === "text" && call.opts.str === String(LEVELS.length))
  assert.ok(last, `the last of the ${LEVELS.length} levels is drawn`)
  assert.ok(
    last.args[1] >= top && last.args[1] <= top + height,
    `the last level is at y=${Math.round(last.args[1])}, outside the ${Math.round(top)} to ` +
      `${Math.round(top + height)} the grid is clipped to`,
  )

  // And moving the cursor still pulls the grid back to it.
  game.menuOption = 1
  frame()
  assert.ok(view.levelScroll < atEnd, "moving the cursor scrolls back to it")
})

test("resizing to the size it already is touches nothing", () => {
  // What stops the resize loop: assigning canvas.width clears the drawing buffer even when the
  // value is unchanged, so a resize that changes nothing has to be a resize that does nothing.
  // The loop calls this every frame now, and a browser zoom calls it with the same numbers.
  let assigned = 0
  const canvas = {
    _w: 0,
    _h: 0,
    get width() {
      return this._w
    },
    set width(value) {
      assigned++
      this._w = value
    },
    get height() {
      return this._h
    },
    set height(value) {
      assigned++
      this._h = value
    },
    getBoundingClientRect: () => ({}),
  }
  const renderer = new Recorder()
  renderer.canvas = canvas
  const view = new GameView(renderer)
  const rect = { width: 600, height: 800 }

  view.resize(rect)
  assert.equal(assigned, 2, "the first one sizes the buffer")
  const size = `${canvas.width}x${canvas.height}`
  view.resize(rect)
  view.resize(rect)
  assert.equal(assigned, 2, "and nothing after it does")
  assert.equal(`${canvas.width}x${canvas.height}`, size)

  // A real change still lands.
  view.resize({ width: 400, height: 700 })
  assert.equal(assigned, 4)
})
