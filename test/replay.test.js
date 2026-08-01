// A round handed over with its working.
//
// The one thing that matters here is that the two ways of arriving at a score agree: the game
// adds it up as it is played, and replay.js adds it up again from the chains alone. A link is
// worth nothing if those can differ, so most of this plays a real game and checks its own run
// back against it.

import test from "node:test"
import assert from "node:assert/strict"

import { Game, PHASE } from "../src/game.js"
import { packRun, unpackRun, replayRun } from "../src/replay.js"
import { SEEDED } from "../src/modes/seeded.js"
import { seedFromCode } from "../src/seed.js"

const FRAME = 1 / 60
const CODE = "314522"

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

// Play the longest chain on the board, the way a hurried player would. Returns false when
// there is nothing left to take.
function popLongest(game) {
  const chain = game.board.longestChain()
  if (chain.length < game.mode.minChain) {
    return false
  }
  game.player.cursor = { col: chain[0].col, row: chain[0].row }
  assert.equal(game.startChain(0), true, "a chain starts where a dot is")
  for (let at = 1; at < chain.length; at++) {
    assert.equal(game.extendTo(0, chain[at].col, chain[at].row), true, "and follows the run")
  }
  assert.ok(game.popChain(0) > 0, "and is worth something")
  settle(game)
  return true
}

// A seeded round played out to its turn limit, or until the board runs dry.
function playRound(game) {
  game.start("seeded", { seed: seedFromCode(CODE) })
  settle(game)
  while (game.turnsLeft > 0 && game.phase === PHASE.PLAYING && popLongest(game)) {
    /* spend the round */
  }
  advanceUntil(game, () => game.phase === PHASE.OVER, 4)
  return game
}

test("a round replays to the score it was played for", () => {
  const game = playRound(new Game())
  assert.equal(game.outcome, "turnsup", "the round ended on its turn limit")
  assert.equal(game.turns, SEEDED.turnLimit)

  const run = game.runText
  assert.ok(run.length > 0, "there is something to hand over")
  const moves = unpackRun(run, SEEDED.cols, SEEDED.rows)
  assert.equal(moves.length, game.turns, "every chain survived the packing")

  const played = replayRun(SEEDED, seedFromCode(CODE), moves)
  assert.equal(played.score, game.player.score, "and adds up to what the game paid")
  assert.equal(played.turns, game.turns)
})

test("the chains pack and unpack unchanged", () => {
  const game = playRound(new Game())
  const moves = unpackRun(game.runText, SEEDED.cols, SEEDED.rows)
  assert.deepEqual(moves, game.moves, "cell for cell, in the order they were linked")
  assert.equal(packRun(moves, SEEDED.cols, SEEDED.rows), game.runText, "and back again")
})

test("a run against the wrong board does not play", () => {
  const game = playRound(new Game())
  const moves = unpackRun(game.runText, SEEDED.cols, SEEDED.rows)
  // Every colour on the board comes from the code, so the same chains against another one are
  // chains through dots that are not there or are not the same colour.
  assert.equal(replayRun(SEEDED, seedFromCode("155341"), moves), null)
})

test("a doctored run is refused rather than scored", () => {
  const game = playRound(new Game())
  const moves = unpackRun(game.runText, SEEDED.cols, SEEDED.rows)

  // A chain lengthened by a cell that is not beside the last one.
  const reached = moves.map((chain) => chain.slice())
  reached[0] = [...reached[0], { col: (reached[0][0].col + 3) % SEEDED.cols, row: 0 }]
  assert.equal(replayRun(SEEDED, seedFromCode(CODE), reached), null)

  // A chain doubled back over a dot it already holds.
  const doubled = moves.map((chain) => chain.slice())
  doubled[0] = [...doubled[0], doubled[0][doubled[0].length - 2]]
  assert.equal(replayRun(SEEDED, seedFromCode(CODE), doubled), null)

  // And a round longer than the mode allows, which is the cheapest forgery there is.
  const padded = [...moves, ...moves]
  assert.equal(replayRun(SEEDED, seedFromCode(CODE), padded), null)
})

test("text that is not a run reads as none", () => {
  for (const bad of ["", "!!!!", "not a run at all!", null, undefined]) {
    assert.equal(unpackRun(bad, SEEDED.cols, SEEDED.rows), null, `${bad} is refused`)
  }
})

test("a link carrying a round opens the card it proves", () => {
  const played = playRound(new Game())
  const run = played.runText

  const game = new Game()
  game.launch(`?seed=${CODE}&run=${run}`)
  assert.equal(game.page, "card")
  assert.equal(game.card.score, played.player.score, "the score was worked out here, not read")
  assert.equal(game.card.turns, played.turns)
  assert.equal(game.card.seed, seedFromCode(CODE), "and it is about the board it names")

  // And the board behind the card is that board, ready to be played.
  assert.equal(game.seedDraft, seedFromCode(CODE))
})

test("a link carrying a forged round opens the board instead of the card", () => {
  const game = new Game()
  // Six characters of nonsense: a chain of some length starting somewhere, which will not be
  // a legal chain on the board the code deals.
  game.launch(`?seed=${CODE}&run=zzzzzzzzzzzz`)
  assert.equal(game.card, null, "nothing was taken on trust")
  assert.notEqual(game.page, "card")
})
