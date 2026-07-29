// The game driven without a browser. Audio is off until something asks for it and
// every storage call swallows its own failure, so a Game can be constructed and
// advanced under node exactly as the loop advances it.

import test from "node:test"
import assert from "node:assert/strict"

import { Game, PHASE } from "../src/game.js"
import { CONFIG } from "../src/config.js"
import { modeById } from "../src/modes/index.js"
import { seedFromCode, dailySeed } from "../src/seed.js"
import { MENU_NOTES, MENU_STEP } from "../src/config.js"
import { Sound } from "../src/audio.js"
import { DOT_SHAPES, DOT_COLOURS } from "../src/palette.js"

const FRAME = 1 / 60

// Advance until the predicate holds, or give up. Returns whether it happened, so a
// test can say what it was waiting for.
function advanceUntil(game, predicate, seconds = 10) {
  for (let i = 0; i < seconds * 60; i++) {
    game.advance(FRAME)
    if (predicate()) {
      return true
    }
  }
  return false
}

const settle = (game) => advanceUntil(game, () => !game.busy && game.board.settled)

// Link the longest chain on the board and hand back what was linked.
function linkLongest(game) {
  const chain = game.board.longestChain()
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  assert.equal(game.startChain(0), true, "a chain starts where a dot is")
  for (let i = 1; i < chain.length; i++) {
    assert.equal(game.extendTo(0, chain[i].col, chain[i].row), true, "and follows the run")
  }
  return chain
}

test("a started board is full and playable", () => {
  const game = new Game()
  game.start("classic")
  const mode = modeById("classic")
  assert.equal(game.phase, PHASE.PLAYING)
  assert.equal(game.page, null)
  assert.equal(game.board.count, mode.cols * mode.rows)
  assert.ok(settle(game), "the board settles")
  assert.equal(game.board.moveAvailable(), true)
})

test("a chain pops, scores, and the board refills", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const chain = linkLongest(game)
  const length = chain.length
  const before = game.board.count

  const scored = game.popChain(0)
  assert.equal(scored, CONFIG.chainScore(length), "the cube of the length, at no multiplier")
  assert.equal(game.player.score, scored)
  assert.equal(game.board.count, before - length, "the dots are off the board at once")
  assert.equal(game.busy, true, "and are still on their way out")

  assert.ok(settle(game), "the pop finishes and the refill lands")
  assert.equal(game.board.count, before, "the board is full again")
  assert.equal(game.player.chain.length, 0)
})

test("a chain of four or more banks a multiplier, a short one spends it", () => {
  const game = new Game()
  game.start("classic")
  settle(game)

  // Pop chains until one is long enough to bank a multiplier.
  let banked = false
  for (let attempt = 0; attempt < 30 && !banked; attempt++) {
    const chain = linkLongest(game)
    const long = chain.length >= CONFIG.MULTIPLIER_CHAIN
    game.popChain(0)
    banked = long
    settle(game)
  }
  assert.equal(banked, true, "a long chain turned up")
  assert.equal(game.player.multiplier, 2)

  // And a pair takes it back down again.
  const pair = game.board.matchingPairs(1)[0]
  game.player.cursor = { col: pair[0].col, row: pair[0].row }
  game.startChain(0)
  game.extendTo(0, pair[1].col, pair[1].row)
  const expected = game.player.score + CONFIG.chainScore(2) * 2
  game.popChain(0)
  assert.equal(game.player.score, expected, "the multiplier applied before it was spent")
  assert.equal(game.player.multiplier, 1)
})

test("a chain shorter than the mode allows cannot be popped", () => {
  const game = new Game()
  game.start("long") // three dots or more
  settle(game)
  const pair = game.board.matchingPairs(1)[0]
  game.player.cursor = { col: pair[0].col, row: pair[0].row }
  game.startChain(0)
  game.extendTo(0, pair[1].col, pair[1].row)

  assert.equal(game.popChain(0), 0, "it scores nothing")
  assert.equal(game.player.chain.length, 2, "and is still held")
  // Letting go of it drops it rather than spending it.
  game.linkRelease(0)
  assert.equal(game.player.chain.length, 0)
  assert.equal(game.player.score, 0)
})

test("holding gathers a chain and letting go spends it", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  assert.equal(game.holdToLink, true, "which is how the game plays unless asked otherwise")
  const pair = game.board.matchingPairs(1)[0]
  game.player.cursor = { col: pair[0].col, row: pair[0].row }

  game.linkPress(0)
  assert.equal(game.player.chain.length, 1, "the press picks a dot up")
  game.extendTo(0, pair[1].col, pair[1].row)
  assert.equal(game.player.chain.length, 2)
  // A second press does nothing: the button is already down as far as the game knows.
  game.linkPress(0)
  assert.equal(game.player.chain.length, 2)

  game.linkRelease(0)
  assert.equal(game.player.chain.length, 0, "and letting go spends it")
  assert.ok(game.player.score > 0)
})

test("the toggle setting splits that into two presses", () => {
  const game = new Game()
  game.settings.link = "toggle"
  game.start("classic")
  settle(game)
  assert.equal(game.holdToLink, false)
  const pair = game.board.matchingPairs(1)[0]
  game.player.cursor = { col: pair[0].col, row: pair[0].row }

  game.linkPress(0)
  game.extendTo(0, pair[1].col, pair[1].row)
  game.linkRelease(0)
  assert.equal(game.player.chain.length, 2, "letting go is not what spends it here")
  game.linkPress(0)
  assert.equal(game.player.chain.length, 0, "a second press is")
  assert.ok(game.player.score > 0)
})

test("losing the window lets go of a held chain, but not a toggled one", () => {
  const held = new Game()
  held.start("classic")
  settle(held)
  held.player.cursor = { col: 0, row: 0 }
  held.linkPress(0)
  assert.equal(held.player.chain.length, 1)
  held.onBlur()
  assert.equal(held.player.chain.length, 0, "the chain was the button being down")

  const toggled = new Game()
  toggled.settings.link = "toggle"
  toggled.start("classic")
  settle(toggled)
  toggled.player.cursor = { col: 0, row: 0 }
  toggled.linkPress(0)
  toggled.onBlur()
  assert.equal(toggled.player.chain.length, 1, "here a chain outlives its press by design")
})

test("a menu opening under a drag ends it, and the board is closed off", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const [from, to] = game.board.matchingPairs(1)[0]
  const before = game.board.count
  game.pointerDown(0, { col: from.col, row: from.row })
  assert.equal(game.player.dragging, true)

  game.togglePause()
  assert.equal(game.player.dragging, false, "the pointer is over a panel now")
  assert.equal(game.player.chain.length, 0)

  // And the drag carrying on reaches nothing: the pointer is not told a page opened.
  game.pointerMove(0, { col: to.col, row: to.row })
  game.pointerUp(0)
  assert.equal(game.player.chain.length, 0, "no chain is gathered behind the panel")
  assert.equal(game.player.score, 0, "and none is spent")
  assert.equal(game.board.count, before, "so the board is the one the menu was opened over")
})

// Walk a menu, collecting the note each move played. Menus are meant to be learnable by
// ear, which is only true if the notes are a function of where the cursor is.
function notesWhile(game, steps) {
  const played = []
  const real = Sound.menuMove
  Sound.menuMove = (step) => played.push(step)
  try {
    steps()
  } finally {
    Sound.menuMove = real
  }
  return played
}

// Every item on the current page, as { note, fixed } - `fixed` being the ones that recur
// between pages and keep their own note wherever they are put.
function pageNotes(game) {
  const rows = game.menuRows()
  const notes = []
  rows.forEach((row, index) => {
    if (row.kind === "heading" || row.kind === "hint") {
      return
    }
    game.menuIndex = index
    if (row.kind === "buttons") {
      row.options.forEach((cell, option) => {
        if (!cell) {
          return
        }
        game.menuOption = option
        notes.push({ note: game.menuNote(), fixed: MENU_NOTES[cell.action] !== undefined })
      })
      return
    }
    // A row of settings is pointed at by the value it holds, so it has one reachable note
    // at a time; that it moves with the value is checked below.
    game.menuOption = 0
    notes.push({ note: game.menuNote(), fixed: false })
  })
  return notes
}

test("every item on every page has its own note", () => {
  const game = new Game()
  game.start("puzzle")
  for (const page of ["title", "modes", "pause", "over", "settings", "controls", "seed"]) {
    game.page = page
    const notes = pageNotes(game)
    assert.ok(notes.length > 1, `${page} offers something`)
    const heard = notes.map((entry) => entry.note)
    assert.equal(
      new Set(heard).size,
      heard.length,
      `${page}: no two items share a note (${heard.join(",")})`,
    )
    // What is not a recurring button is numbered down the page, so the pitch rises the
    // way a reader's eye does.
    const positional = notes.filter((entry) => !entry.fixed).map((entry) => entry.note)
    for (let i = 1; i < positional.length; i++) {
      assert.ok(positional[i] > positional[i - 1], `${page}: item ${i} is above the one before`)
    }
  }
})

test("a recurring button sounds the same wherever it is", () => {
  const game = new Game()
  game.start("puzzle")
  const heard = new Map()
  for (const page of ["title", "modes", "pause", "over", "settings", "controls", "seed"]) {
    game.page = page
    const rows = game.menuRows()
    rows.forEach((row, index) => {
      if (row.kind !== "buttons") {
        return
      }
      row.options.forEach((cell, option) => {
        if (!cell || MENU_NOTES[cell.action] === undefined) {
          return
        }
        game.menuIndex = index
        game.menuOption = option
        const note = game.menuNote()
        const before = heard.get(cell.action)
        if (before !== undefined) {
          assert.equal(note, before, `${cell.action} sounds the same on ${page} as elsewhere`)
        }
        heard.set(cell.action, note)
      })
    })
  }
  // Back appears on more than one page, which is the whole point of the table.
  assert.ok(heard.has("back") && heard.has("settings"), "the recurring buttons were found")
  // And they sit below the root, where the contents of a page do not go.
  for (const note of heard.values()) {
    assert.ok(note < 0, "furniture sounds below the contents")
  }
})

test("a setting's note moves with the value it holds", () => {
  const game = new Game()
  game.page = "settings"
  const rows = game.menuRows()
  game.menuIndex = rows.findIndex((row) => row.id === "brightness")
  const heard = []
  for (const level of [0, 1, 2]) {
    game.settings.brightness = level
    heard.push(game.menuNote())
  }
  assert.deepEqual(
    heard,
    [heard[0], heard[0] + MENU_STEP, heard[0] + MENU_STEP * 2],
    "each value is its own note, a step apart",
  )
})

test("the same menu item plays the same note whenever it is reached", () => {
  const first = new Game()
  first.menuTap(0)
  const going = notesWhile(first, () => {
    first.menuMove(1)
    first.menuMove(1)
  })

  // A fresh game, the same route: the notes cannot depend on anything but where the
  // cursor ended up.
  const second = new Game()
  second.menuTap(0)
  const again = notesWhile(second, () => {
    second.menuMove(1)
    second.menuMove(1)
  })
  assert.deepEqual(again, going)
})

test("across a row is up the scale too, so a grid has a shape you can hear", () => {
  const game = new Game()
  game.menuTap(0)
  const across = notesWhile(game, () => {
    game.menuAdjust(1)
    game.menuAdjust(1)
    game.menuAdjust(1)
  })
  for (let i = 1; i < across.length; i++) {
    assert.ok(across[i] > across[i - 1], "each cell along is a step up")
  }
})

test("the mode grid is two across, and down from its last line leaves it", () => {
  const game = new Game()
  game.menuTap(0)
  const rows = game.menuRows()
  const grid = rows.findIndex((row) => row.id === "modes")
  const modes = rows[grid].options
  assert.equal(rows[grid].columns, 2)

  game.menuIndex = grid
  game.menuOption = modes.length - 1
  game.menuMove(1)
  assert.notEqual(game.menuIndex, grid, "there is no line left to move onto")
})

test("down from the end of a short row stays in the block", () => {
  // A line holding fewer cells than the one above it, which the shipped pages have wherever
  // a button keeps a corner of the panel to itself: the cursor takes the nearest cell along
  // the short line and does not fall out of the block or land on the placeholder.
  const game = new Game()
  game.menuRows = () => [
    { id: "pair", kind: "buttons", columns: 2, options: [{ action: "a" }, { action: "b" }] },
    { id: "one", kind: "buttons", columns: 2, options: [{ action: "c" }, null] },
  ]
  game.menuIndex = 0
  game.menuOption = 1
  game.menuMove(1)
  assert.equal(game.menuIndex, 1, "onto the short line")
  assert.equal(game.menuOption, 0, "and back along it, off the cell that only holds its place")
})

test("running the cursor over the board says what is under it", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  // A run of three along the bottom row, with the rest of that row made unmatchable so
  // the two cases are next to each other.
  const row = game.board.rows - 1
  const colours = [0, 0, 0, 1, 2, 1]
  colours.forEach((colour, col) => {
    game.board.at(col, row).colour = colour
  })
  for (let col = 0; col < game.board.cols; col++) {
    game.board.at(col, row - 1).colour = 3
  }
  game.board.at(3, row - 1).colour = 4

  const heard = []
  const real = Sound.cursor
  Sound.cursor = (reach, minChain) => heard.push({ reach, minChain })
  try {
    game.player.cursor = { col: 5, row }
    game.moveCursor(0, -1, 0) // onto the lone 1 at col 4... which is a 2, so alone
    game.moveCursor(0, -1, 0) // col 3: a 1, alone on its row
    game.moveCursor(0, -1, 0) // col 2: the end of the run of three
    game.moveCursor(0, -1, 0) // col 1: the middle of it
  } finally {
    Sound.cursor = real
  }

  assert.equal(heard.length, 4, "every step said something")
  assert.ok(
    heard.every((call) => call.minChain === game.mode.minChain),
    "and said what counts as a chain here",
  )
  // The two dots with nothing to join sound as nothing to join. The two in the run of
  // three report what a chain starting on them could reach - which is the whole run from
  // its end, and only two from the middle, since a chain begun in the middle of a run can
  // still only go one way from there.
  assert.equal(heard[0].reach, 1, "a dot of its own")
  assert.equal(heard[1].reach, 1, "and another")
  assert.equal(heard[2].reach, 3, "the end of a run of three")
  assert.equal(heard[3].reach, 2, "the middle of it, which can only go one way")
})

test("what the cursor can reach is capped, not counted forever", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  // One colour everywhere: the reach from any dot is the whole board, and the answer has
  // to come back bounded rather than enumerate every path across it.
  for (const dot of game.board.dots) {
    dot.colour = 0
  }
  const reach = game.board.reachFrom(game.board.at(0, 0), 6)
  assert.equal(reach, 6)
})

test("unpicking a chain walks back down the scale", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  // A run of three along the bottom, and something else beside it so the run ends there.
  const row = game.board.rows - 1
  for (let col = 0; col < 3; col++) {
    game.board.at(col, row).colour = 0
  }
  game.board.at(3, row).colour = 1

  const played = []
  const real = Sound.link
  Sound.link = (index) => played.push(index)
  try {
    game.player.cursor = { col: 0, row }
    game.startChain(0)
    game.extendTo(0, 1, row)
    game.extendTo(0, 2, row)
    game.extendTo(0, 1, row) // back onto the middle dot, which retracts
    game.extendTo(0, 0, row)
  } finally {
    Sound.link = real
  }
  assert.deepEqual(played, [0, 1, 2, 1, 0], "up the scale and back down it")
  assert.equal(game.player.chain.length, 1)
})

test("a board sat in front of for a while points out a move", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  assert.equal(game.hint, null, "nothing to say yet")

  // Nothing happens for as long as the board is prepared to wait.
  assert.ok(
    advanceUntil(game, () => game.hint != null, CONFIG.HINT_DELAY + 2),
    "it says something",
  )
  const hinted = game.hint.dots
  assert.ok(hinted.length >= game.mode.minChain, "and what it points at is a chain")
  for (let i = 1; i < hinted.length; i++) {
    assert.equal(hinted[i].colour, hinted[0].colour, "all of one colour")
  }
  // With motion allowed, the pointing is done by the wobble.
  assert.ok(
    hinted.some((dot) => Math.abs(dot.wobble.value) + Math.abs(dot.wobble.velocity) > 0),
    "the dots it named are moving",
  )
})

test("picking a dot up stops the board pointing at things", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const dot = game.board.dots[0]
  game.player.cursor = { col: dot.col, row: dot.row }
  game.startChain(0)
  assert.equal(
    advanceUntil(game, () => game.hint != null, CONFIG.HINT_DELAY + 2),
    false,
    "a chain in hand is someone thinking, not someone stuck",
  )
})

test("hints can be turned off", () => {
  const game = new Game()
  game.settings.hints = "off"
  game.start("classic")
  settle(game)
  assert.equal(game.hintsOn, false)
  assert.equal(
    advanceUntil(game, () => game.hint != null, CONFIG.HINT_DELAY + 4),
    false,
  )
})

test("nothing but a hint ever wobbles a dot", () => {
  const game = new Game()
  // Hints off, so anything found moving was moved by something else.
  game.settings.hints = "off"
  game.start("classic")

  const still = (where) => {
    for (const dot of game.board.dots) {
      assert.equal(
        Math.abs(dot.wobble.value) + Math.abs(dot.wobble.velocity),
        0,
        `${where}: a dot at ${dot.col},${dot.row} is wobbling`,
      )
    }
  }

  // Through a deal, a chain spent, the collapse and the refill that follows: the wobble is
  // the hint and nothing else, which is why the motion setting does not offer to turn one
  // off. If a landing or a pop ever drives it again, this is the test that says so.
  for (let i = 0; i < 240; i++) {
    game.advance(FRAME)
    still("dealing")
  }
  const chain = game.board.longestChain()
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  game.startChain(0)
  for (let i = 1; i < chain.length; i++) {
    game.extendTo(0, chain[i].col, chain[i].row)
  }
  game.popChain(0)
  for (let i = 0; i < 300; i++) {
    game.advance(FRAME)
    still("popping and refilling")
  }
})

test("a reduced-motion hint names its dots without moving them", () => {
  const game = new Game()
  game.settings.motion = "reduced"
  game.start("classic")
  settle(game)
  assert.ok(advanceUntil(game, () => game.hint != null, CONFIG.HINT_DELAY + 2))
  for (const dot of game.hint.dots) {
    assert.equal(dot.wobble.value, 0, "nothing wobbles")
    assert.equal(dot.wobble.velocity, 0)
  }
})

test("a hint fades out behind a menu, and the board falls at the settings' rate", () => {
  const game = new Game()
  game.settings.motion = "reduced"
  game.start("classic")
  settle(game)
  assert.ok(advanceUntil(game, () => game.hint != null, CONFIG.HINT_DELAY + 2))
  game.togglePause()
  // The ring is drawn behind the panel, so it has to go out while it is there.
  assert.ok(
    advanceUntil(game, () => game.hint == null, CONFIG.HINT_RING_LIFE + 1),
    "the ring fades while the menu is up",
  )

  // And the fall behind the panel runs at the same rate as the fall in front of it.
  const paused = new Game()
  paused.settings.motion = "reduced"
  paused.start("classic")
  const dropping = paused.board.dots[0]
  paused.togglePause()
  const from = dropping.y
  paused.advance(FRAME)
  const behind = dropping.y - from

  const playing = new Game()
  playing.settings.motion = "reduced"
  playing.start("classic")
  const infront = playing.board.dots[0]
  const was = infront.y
  playing.advance(FRAME)
  assert.equal(behind, infront.y - was, "reduced motion reaches the board a menu sits over")
})

test("every dot colour has a shape, and the confusable pairs do not share one", () => {
  assert.equal(DOT_SHAPES.length, DOT_COLOURS, "one shape per colour")

  // Which colours get mistaken for each other. Red-green deficiency is the common case by
  // a long way: it takes red for teal, red for orange, and purple for blue. Those pairs
  // are the whole reason the shapes are assigned the way they are, so each has to be
  // properly distinguishable - a different number of corners, not the same shape turned.
  const confused = [
    [0, 1], // purple, blue
    [2, 3], // teal, red
    [3, 4], // red, orange
    [2, 4], // teal, orange
  ]
  for (const [a, b] of confused) {
    const one = DOT_SHAPES[a]
    const other = DOT_SHAPES[b]
    assert.notEqual(
      one.sides,
      other.sides,
      `colours ${a} and ${b} are confusable, so they cannot both be ${one.sides}-sided`,
    )
  }

  // And where two colours do share a side count, they are turned well apart.
  for (let a = 0; a < DOT_SHAPES.length; a++) {
    for (let b = a + 1; b < DOT_SHAPES.length; b++) {
      if (DOT_SHAPES[a].sides !== DOT_SHAPES[b].sides || DOT_SHAPES[a].sides < 3) {
        continue
      }
      const apart = Math.abs(DOT_SHAPES[a].turn - DOT_SHAPES[b].turn)
      const sector = (Math.PI * 2) / DOT_SHAPES[a].sides
      // Half a sector is as far apart as two polygons of the same order can be turned:
      // beyond that they start coming back into line with each other.
      assert.ok(
        Math.abs(apart % sector) > sector * 0.4,
        `colours ${a} and ${b} are both ${DOT_SHAPES[a].sides}-sided and barely turned apart`,
      )
    }
  }
})

test("shapes are off until asked for, and then every colour has one", () => {
  const game = new Game()
  assert.equal(game.shapeFor(0), null, "off unless asked for")

  game.settings.shapes = "on"
  for (let colour = 0; colour < DOT_COLOURS; colour++) {
    const shape = game.shapeFor(colour)
    assert.ok(shape, `colour ${colour} has one`)
    assert.equal(typeof shape.sides, "number")
    assert.equal(typeof shape.turn, "number")
  }
})

test("a reduced-motion session throws no particles", () => {
  const game = new Game()
  game.settings.motion = "reduced"
  game.start("classic")
  settle(game)
  assert.equal(game.reducedMotion, true)

  const chain = game.board.longestChain()
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  game.startChain(0)
  for (let i = 1; i < chain.length; i++) {
    game.extendTo(0, chain[i].col, chain[i].row)
  }
  game.popChain(0)
  // Long enough for every dot in the chain to have burst, and not so long that the score
  // floating off it has faded.
  advanceUntil(game, () => !game.busy, 1)
  assert.equal(game.particles.count, 0, "nothing was thrown")
  assert.ok(game.particles.floaters.length > 0, "but the score still says what it was")
  // And it stays where it was spent rather than rising.
  const floater = game.particles.floaters[0]
  const wasAt = floater.y
  game.advance(FRAME)
  assert.equal(floater.y, wasAt)
})

test("the cursor drags the chain, and stepping back retracts it", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const pair = game.board.matchingPairs(1)[0]
  // Only take pairs lying along a row, so the move is one step right.
  const [first, second] = pair[0].row === pair[1].row ? pair : [null, null]
  if (!first) {
    return // this deal had no horizontal pair; the rule is covered by the board tests
  }
  game.player.cursor = { col: first.col, row: first.row }
  game.linkPress(0)
  game.moveCursor(0, 1, 0)
  assert.equal(game.player.chain.length, 2, "the cursor took the chain with it")
  assert.equal(game.player.cursor.col, second.col)

  game.moveCursor(0, -1, 0)
  assert.equal(game.player.chain.length, 1, "and stepping back gave the dot up")
})

test("a move a held chain cannot make is refused, and says so", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  // Somewhere with a dot that does not match the one to its right.
  const dot = game.board.dots.find((entry) => {
    const right = game.board.at(entry.col + 1, entry.row)
    return right && right.colour !== entry.colour
  })
  game.player.cursor = { col: dot.col, row: dot.row }
  game.linkPress(0)
  assert.equal(game.player.chain.length, 1)

  let refusals = 0
  const real = Sound.blocked
  Sound.blocked = () => refusals++
  try {
    game.moveCursor(0, 1, 0)
  } finally {
    Sound.blocked = real
  }
  // Even with only one dot in hand. While the button is held the chain is the button, and
  // a thumb going the wrong way must not throw away what is being held.
  assert.equal(game.player.chain.length, 1, "still held")
  assert.equal(game.player.cursor.col, dot.col, "and the cursor did not move")
  assert.equal(refusals, 1, "the refusal was audible")
})

test("pushing at the edge of the board is refused too, without rattling", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  game.player.cursor = { col: 0, row: 0 }

  let refusals = 0
  const real = Sound.blocked
  Sound.blocked = () => refusals++
  try {
    // Held against the edge: the cursor repeats at its own rate, and every one of those
    // would otherwise be a noise.
    for (let i = 0; i < 20; i++) {
      game.moveCursor(0, -1, 0)
      game.advance(FRAME)
    }
  } finally {
    Sound.blocked = real
  }
  assert.equal(game.player.cursor.col, 0, "nowhere to go")
  assert.ok(refusals >= 1, "it said so")
  assert.ok(refusals <= 3, `and not twenty times over (${refusals})`)
})

test("a board with no move left ends the game, after a pause", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  // A checkerboard has no two neighbours alike. Written straight onto the settled
  // board, which is what the game judges.
  for (const dot of game.board.dots) {
    dot.colour = (dot.col + dot.row) % 2
  }
  assert.equal(game.board.moveAvailable(), false)

  game.advance(FRAME)
  assert.equal(game.phase, PHASE.PLAYING, "it is not called straight away")
  assert.ok(
    advanceUntil(game, () => game.phase === PHASE.OVER, 4),
    "but it is called",
  )
  assert.equal(game.outcome, "lost")
  assert.equal(game.page, "over")
})

test("the timed mode ends when the clock runs out", () => {
  const game = new Game()
  game.start("rush")
  assert.equal(game.timeLeft, modeById("rush").timeLimit)
  game.timeLeft = 0.5
  assert.ok(advanceUntil(game, () => game.phase === PHASE.OVER, 2))
  assert.equal(game.outcome, "timeup")
})

test("clearing a board that does not refill is a win", () => {
  const game = new Game()
  game.start("clearout")
  settle(game)
  // Take everything off in one go, which is what the last chain amounts to.
  game.board.remove(game.board.dots.slice())
  assert.equal(game.board.empty, true)
  assert.ok(advanceUntil(game, () => game.phase === PHASE.OVER, 4))
  assert.equal(game.outcome, "won")
})

test("the best score is kept per mode", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  game.player.score = 1234
  game.timeLeft = 0
  game.advance(FRAME)
  // Force the end rather than waiting for a dead board.
  for (const dot of game.board.dots) {
    dot.colour = (dot.col + dot.row) % 2
  }
  advanceUntil(game, () => game.phase === PHASE.OVER, 4)
  assert.equal(game.best.classic, 1234)
  assert.equal(game.best.rush, undefined, "a different board is a different record")
})

// ---- the seeded mode ------------------------------------------------------
// The whole point of the mode is that two people can be dealt the same dots, so these are
// the tests it exists for.

// The board as text, for comparing one deal with another.
const dealt = (game) => game.board.grid.map((dot) => (dot ? String(dot.colour) : ".")).join("")

test("the same code deals the same board, and another code does not", () => {
  const first = new Game()
  first.start("seeded", { seed: 4242 })
  const second = new Game()
  second.start("seeded", { seed: 4242 })
  assert.equal(dealt(second), dealt(first), "one code, one board")

  const other = new Game()
  other.start("seeded", { seed: 4243 })
  assert.notEqual(dealt(other), dealt(first), "and the next code along is its own board")
})

test("the same code deals the same colours after the same play", () => {
  // Not just the opening deal: the refills come off the same generator, so two players who
  // play a board the same way are still on the same board ten pops later.
  const play = (seed) => {
    const game = new Game()
    game.start("seeded", { seed })
    settle(game)
    for (let pop = 0; pop < 10; pop++) {
      linkLongest(game)
      game.linkRelease(0)
      settle(game)
    }
    return { board: dealt(game), score: game.player.score }
  }
  const first = play(777)
  const second = play(777)
  assert.equal(second.board, first.board, "the same dots came back")
  assert.equal(second.score, first.score, "and the same play paid the same")
})

test("a restart deals the code again", () => {
  const game = new Game()
  game.start("seeded", { seed: 100 })
  settle(game)
  const opening = dealt(game)
  linkLongest(game)
  game.linkRelease(0)
  settle(game)
  assert.notEqual(dealt(game), opening, "the board moved on")
  // Restart names no code, so the one in play carries: another go at the same board is what
  // the mode is for.
  game.start("seeded")
  assert.equal(dealt(game), opening)
  assert.equal(game.seed, 100)
})

test("the code carries across another mode being played in between", () => {
  const game = new Game()
  game.start("seeded", { seed: 55 })
  const opening = dealt(game)
  game.start("classic")
  game.start("seeded")
  assert.equal(game.seed, 55)
  assert.equal(dealt(game), opening)
})

test("only a seeded mode is dealt from a code", () => {
  const game = new Game()
  game.start("classic")
  const first = dealt(game)
  game.start("classic")
  assert.notEqual(dealt(game), first, "a mode with no code deals a fresh board every time")
  // And the mode may never deal a powerup: that would cost a roll of the same generator the
  // colours come from and shift every board every code has ever given.
  assert.equal(modeById("seeded").specialChance, 0)
})

test("the best score is kept per code", () => {
  const game = new Game()
  game.start("seeded", { seed: 8888 })
  settle(game)
  game.player.score = 4321
  for (const dot of game.board.dots) {
    dot.colour = (dot.col + dot.row) % 2
  }
  advanceUntil(game, () => game.phase === PHASE.OVER, 4)
  assert.equal(game.seedBestFor(8888), 4321)
  assert.equal(game.seedBestFor(8889), 0, "another board is another record")
  assert.equal(game.bestScore, 4321, "and it is the code's record the game is played against")
})

test("a finished seeded board offers another code, and escape comes back to it", () => {
  const game = new Game()
  game.start("seeded", { seed: 300 })
  settle(game)
  for (const dot of game.board.dots) {
    dot.colour = (dot.col + dot.row) % 2
  }
  advanceUntil(game, () => game.page === "over", 4)
  const offered = game
    .menuRows()
    .flatMap((row) => row.options || [])
    .filter(Boolean)
    .map((cell) => cell.action)
  assert.ok(offered.includes("again"), "another go at the same board")
  assert.ok(offered.includes("seed"), "and the way to a different one")

  game.menuIndex = game
    .menuRows()
    .findIndex((row) => (row.options || []).some((c) => c && c.action === "seed"))
  game.menuOption = 0
  game.menuConfirm()
  assert.equal(game.page, "seed")
  game.menuBack()
  assert.equal(game.page, "over", "and back to the score it came from")
})

test("a code from a link opens the picker on it, and a broken one is ignored", () => {
  const game = new Game()
  assert.equal(game.openSharedSeed("314522"), true)
  assert.equal(game.page, "seed")
  assert.equal(game.seedDraft, seedFromCode("314522"))
  assert.equal(game.phase, PHASE.TITLE, "opened, not started: the page names the board first")

  const ignored = new Game()
  assert.equal(ignored.openSharedSeed("nope"), false)
  assert.equal(ignored.page, "title")
})

test("the picker walks its code and a press steps a dot round the colours", () => {
  const game = new Game()
  game.menuTap(0)
  game.openSharedSeed("111111")
  const strip = game.menuRows().findIndex((row) => row.layout === "seed")
  assert.ok(strip >= 0, "the page has a strip of dots")
  // The page opens on Play, since the code offered is one press from being played.
  assert.notEqual(game.menuIndex, strip)

  game.menuIndex = strip
  game.menuOption = 0
  game.menuConfirm()
  assert.equal(game.seedDraft, seedFromCode("211111"), "the first dot stepped on")
  // Round, not stopping at the end: the ends of a code mean nothing.
  for (let step = 0; step < 4; step++) {
    game.menuConfirm()
  }
  assert.equal(game.seedDraft, seedFromCode("111111"), "and back where it started")

  // Left and right walk along it, the way they walk any block of buttons.
  game.menuAdjust(1)
  assert.equal(game.menuOption, 1)
  game.menuConfirm()
  assert.equal(game.seedDraft, seedFromCode("121111"))
})

test("a digit typed into the picker fills the code in and moves along", () => {
  const game = new Game()
  game.openSharedSeed("111111")
  const strip = game.menuRows().findIndex((row) => row.layout === "seed")
  game.menuIndex = strip
  game.menuOption = 0
  assert.equal(game.typingSeed, true, "the code is where a typed digit goes")
  for (const digit of "314522") {
    assert.equal(game.typeSeedDigit(digit), true)
  }
  assert.equal(game.seedDraft, seedFromCode("314522"), "six presses type a whole code")
  assert.equal(game.menuOption, 0, "and it comes round to the start")

  assert.equal(game.typeSeedDigit("6"), false, "no dot is that colour")
  assert.equal(game.typeSeedDigit("a"), false)
  assert.equal(game.seedDraft, seedFromCode("314522"), "and a refused key changes nothing")

  // Nowhere else in the game takes a character.
  game.menuIndex = strip + 2
  assert.equal(game.typingSeed, false)
  assert.equal(game.typeSeedDigit("3"), false)
})

test("today's board is what the picker offers", () => {
  const game = new Game()
  assert.equal(game.seedDraft, dailySeed())
  game.openSharedSeed("555555")
  game.menuIndex = game.menuRows().findIndex((row) => row.layout === "seed")
  // And Today puts it back, for a player who has walked away from it.
  const rows = game.menuRows()
  const today = rows.findIndex((row) =>
    (row.options || []).some((cell) => cell && cell.action === "seedToday"),
  )
  game.menuIndex = today
  game.menuOption = 0
  game.menuConfirm()
  assert.equal(game.seedDraft, dailySeed())
})

test("a menu leaves the board alone", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  const before = game.board.count
  game.togglePause()
  assert.equal(game.page, "pause")
  // A chain cannot be started or spent while the menu is up.
  const dot = game.board.dots[0]
  game.player.cursor = { col: dot.col, row: dot.row }
  assert.equal(game.startChain(0), false)
  game.advance(FRAME)
  assert.equal(game.board.count, before)
  game.togglePause()
  assert.equal(game.page, null)
  assert.equal(game.startChain(0), true, "and works again once it is closed")
})

test("the endless mode never leaves a dead board", () => {
  const game = new Game()
  game.start("endless")
  settle(game)
  for (let pop = 0; pop < 40; pop++) {
    assert.equal(game.board.moveAvailable(), true, `there is still a move after ${pop} chains`)
    linkLongest(game)
    game.popChain(0)
    assert.ok(settle(game), "the board settles between chains")
  }
  assert.equal(game.phase, PHASE.PLAYING, "and it is still going")
})

test("playing at random for a while breaks nothing", () => {
  const game = new Game()
  game.start("classic")
  settle(game)
  for (let step = 0; step < 4000; step++) {
    const roll = Math.random()
    if (roll < 0.5) {
      const dx = Math.random() < 0.5 ? 1 : -1
      const dy = Math.random() < 0.5 ? 1 : -1
      game.moveCursor(0, Math.random() < 0.5 ? dx : 0, Math.random() < 0.5 ? dy : 0)
    } else if (roll < 0.9) {
      game.linkPress(0)
    } else {
      game.cancelChain(0)
    }
    game.advance(FRAME)
    if (game.phase === PHASE.OVER) {
      game.start("classic")
      settle(game)
    }
    // The invariants: the grid and the dot list agree, and nothing is claimed by a
    // player who is not holding it.
    assert.equal(
      game.board.dots.length,
      game.board.grid.filter(Boolean).length,
      "the grid and the dot list agree",
    )
    for (const dot of game.board.dots) {
      if (dot.claim != null) {
        assert.ok(game.players[dot.claim].chain.includes(dot), "a claim means a chain holds it")
      }
    }
  }
})
