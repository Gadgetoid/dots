// The game driven without a browser. Audio is off until something asks for it and
// every storage call swallows its own failure, so a Game can be constructed and
// advanced under node exactly as the loop advances it.

import test from "node:test"
import assert from "node:assert/strict"

import { Game, PHASE } from "../src/game.js"
import { CONFIG } from "../src/config.js"
import { modeById } from "../src/modes/index.js"
import { Sound } from "../src/audio.js"

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

test("a single held dot is dropped rather than blocking the cursor", () => {
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
  game.moveCursor(0, 1, 0)
  assert.equal(game.player.chain.length, 0, "the chain was let go")
  assert.equal(game.player.cursor.col, dot.col + 1, "and the cursor moved anyway")
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
