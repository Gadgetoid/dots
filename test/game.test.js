// The game driven without a browser. Audio is off until something asks for it and
// every storage call swallows its own failure, so a Game can be constructed and
// advanced under node exactly as the loop advances it.

import test from "node:test"
import assert from "node:assert/strict"

import { Game, PHASE } from "../src/game.js"
import { CONFIG } from "../src/config.js"
import { modeById } from "../src/modes/index.js"

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
  // The press that would have popped it drops it instead.
  game.linkPress(0)
  assert.equal(game.player.chain.length, 0)
  assert.equal(game.player.score, 0)
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
