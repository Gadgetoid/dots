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
  text(str, x, y, opts) {
    this.#record("text", [x, y], { ...opts, str })
  }
  measureText(str, size) {
    return str.length * size * 0.6
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

test("a cleared level draws its banner", () => {
  const game = new Game()
  game.start("puzzle")
  settle(game)
  game.board.remove(game.board.dots.slice())
  for (let i = 0; i < 60 * 3 && !game.banner; i++) {
    game.advance(FRAME)
  }
  assert.ok(game.banner, "there was something to say")
  assertSane(drawn(game), "level cleared")
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
