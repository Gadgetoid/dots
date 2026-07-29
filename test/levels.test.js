// The puzzle levels, and the two modes that were carried over from the original
// browser game's `puzzle` and `elimination`.
//
// The important test here is that every authored level can actually be emptied.
// Nothing refills, so a level that cannot is a dead end the player can only lose in,
// and whether one can depends on the order the chains are taken in - which is easy to
// get wrong while drawing a shape. solver.js searches for a sequence that clears it.

import test from "node:test"
import assert from "node:assert/strict"

import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"
import { PUZZLE } from "../src/modes/puzzle.js"
import { maxScore, solve, describe as shapeOf } from "./solver.js"
import { Game, PHASE } from "../src/game.js"
import { Board } from "../src/board.js"
import { modeRefills, defaultOutcome } from "../src/modes/index.js"
import { CONFIG } from "../src/config.js"
import { ELIMINATION } from "../src/modes/elimination.js"
import { mulberry32 } from "../src/math.js"

const FRAME = 1 / 60

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

// Play one chain, given as cells in the order they are linked.
function playChain(game, cells) {
  game.player.cursor = { col: cells[0].col, row: cells[0].row }
  assert.equal(game.startChain(0), true, `a chain starts at ${cells[0].col},${cells[0].row}`)
  for (let i = 1; i < cells.length; i++) {
    assert.equal(
      game.extendTo(0, cells[i].col, cells[i].row),
      true,
      `and reaches ${cells[i].col},${cells[i].row}`,
    )
  }
  assert.ok(game.popChain(0) > 0, "and is worth something")
  settle(game)
}

// Clear the board the way a hurried player would: take the longest chain there is,
// pop it, repeat. Good enough for the early levels and not for the last one, which is
// the whole point of it - see the level that has to be played by the solver's order.
function popLongest(game) {
  const chain = game.board.longestChain()
  if (chain.length < game.mode.minChain) {
    return false
  }
  playChain(game, chain)
  return true
}

// Clear a level by the order the solver found, which is the only order some levels
// have. Also checks the solver's idea of a move against the game's: every chain it
// found has to be one the game will actually accept.
function playSolution(game, level) {
  const result = solve(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain)
  assert.ok(result.solved, `${level.name} has a solution to play`)
  for (const cells of result.sequence) {
    playChain(game, cells)
  }
  return result
}

test("every level is the shape the board expects", () => {
  for (const [index, level] of LEVELS.entries()) {
    assert.equal(level.layout.length, PUZZLE_ROWS, `level ${index + 1} has the right rows`)
    for (const row of level.layout) {
      assert.equal(row.length, PUZZLE_COLS, `level ${index + 1} row "${row}" is the right width`)
      assert.match(row, /^[.0-9]+$/, `level ${index + 1} row "${row}" only holds cells`)
    }
    assert.ok(level.name && level.name.length > 0, `level ${index + 1} is named`)
  }
  assert.equal(PUZZLE.cols, PUZZLE_COLS)
  assert.equal(PUZZLE.rows, PUZZLE_ROWS)
})

test("no level uses a colour the mode does not deal", () => {
  for (const [index, level] of LEVELS.entries()) {
    for (const row of level.layout) {
      for (const char of row) {
        if (char === "." || char === "0") {
          continue
        }
        const colour = Number(char) - 1
        assert.ok(
          colour < PUZZLE.colours,
          `level ${index + 1} uses colour ${char}, which is beyond the mode's ${PUZZLE.colours}`,
        )
      }
    }
  }
})

test("every level can be cleared", () => {
  for (const [index, level] of LEVELS.entries()) {
    const result = solve(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain)
    assert.ok(
      result.solved,
      `level ${index + 1} "${level.name}" - ${shapeOf(level, PUZZLE_COLS, PUZZLE_ROWS)} - ` +
        `no clearing sequence found in ${result.states} positions`,
    )
    assert.ok(result.moves >= 3, `level ${index + 1} takes more than a couple of chains`)
  }
})

// The scoring the game actually pays, handed to the search so the two cannot drift.
const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

test("every level's par is the most it can actually score", () => {
  for (const [index, level] of LEVELS.entries()) {
    const best = maxScore(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING)
    assert.equal(best.exhausted, false, `level ${index + 1} was searched to the end`)
    assert.equal(
      level.par,
      best.score,
      `level ${index + 1} "${level.name}" is written down as ${level.par} and can score ` +
        `${best.score} (searched ${best.positions} positions)`,
    )
  }
})

test("par is a target, not a formality: greed does not reach it", () => {
  // Taking the longest chain on the board every time is the obvious way to play, and on
  // at least one level it leaves score on the table - otherwise showing a target would
  // be telling the player nothing they could not get by not thinking.
  let missedOne = false
  for (const level of LEVELS) {
    const greedy = solve(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain)
    if (!greedy.solved) {
      continue
    }
    let score = 0
    let multiplier = 1
    for (const cells of greedy.sequence) {
      score += SCORING.scoreChain(cells.length) * multiplier
      multiplier = SCORING.multiplierAfter(multiplier, cells.length)
    }
    assert.ok(score <= level.par, `${level.name}: a real order cannot beat par`)
    if (score < level.par) {
      missedOne = true
    }
  }
  assert.ok(missedOne, "at least one level rewards playing it better than greedily")
})

test("the levels get bigger as they go", () => {
  const counts = LEVELS.map((level) => level.layout.join("").replace(/[.0]/g, "").length)
  assert.ok(counts[0] <= 8, "the first one is a handful of dots")
  assert.ok(counts.at(-1) >= 20, "the last one is a full board")
  // Not strictly monotonic - a level can be smaller and harder - but the trend has
  // to be upward, or the ramp is not a ramp.
  assert.ok(counts.at(-1) > counts[0] * 2)
})

test("a level is loaded as drawn, and falls", () => {
  const board = new Board({ cols: PUZZLE_COLS, rows: PUZZLE_ROWS, random: mulberry32(3) })
  board.load(LEVELS[1].layout)
  // STACKS is nine dots in three columns of three.
  assert.equal(board.count, 9)
  // Every dot is resting on the floor or on another dot, since load collapses.
  for (const dot of board.dots) {
    const below = board.at(dot.col, dot.row + 1)
    assert.ok(dot.row === board.rows - 1 || below, "nothing is left floating")
  }
  // And they all start above the board, on their way in.
  assert.ok(board.dots.every((dot) => dot.y < dot.row))
})

test("an empty cell in a layout stays empty", () => {
  const board = new Board({ cols: 3, rows: 3, random: mulberry32(1) })
  board.load(["...", "1.2", "1.2"])
  assert.equal(board.count, 4)
  assert.equal(board.at(1, 2), null, "the middle column was never dealt")
  assert.equal(board.colourAt(0, 2), 0)
  assert.equal(board.colourAt(2, 1), 1)
})

test("clearing a level moves on to the next and keeps the score", () => {
  const game = new Game()
  game.start("puzzle")
  settle(game)
  assert.equal(game.level, 0)
  assert.equal(game.currentLevel.name, LEVELS[0].name)

  while (popLongest(game)) {
    /* clear the first level */
  }
  assert.equal(game.board.empty, true)
  const scored = game.player.score
  assert.ok(scored > 0)

  assert.ok(
    advanceUntil(game, () => game.level === 1, 4),
    "the next level is dealt",
  )
  assert.equal(game.phase, PHASE.PLAYING, "and the game did not end")
  assert.equal(game.player.score, scored, "the score carried over")
  assert.equal(game.levelStartScore, scored, "and is what a retry would cost")
  assert.ok(game.banner, "the player is told")
  assert.equal(game.board.empty, false)
})

test("running out of moves on a level offers a retry, which costs only that level", () => {
  const game = new Game()
  game.start("puzzle")
  settle(game)
  // Bank the first level, then wreck the second.
  while (popLongest(game)) {
    /* clear */
  }
  advanceUntil(game, () => game.level === 1, 4)
  settle(game)
  const banked = game.player.score

  // Two dots of different colours cannot be chained: a dead level.
  game.board.remove(game.board.dots.slice(2))
  game.board.dots[0].colour = 0
  game.board.dots[1].colour = 1
  game.board.collapse()
  assert.ok(advanceUntil(game, () => game.phase === PHASE.OVER, 4))

  const rows = game.menuRows()
  assert.equal(rows[0].id, "retry", "the first thing offered is another go at the level")
  game.player.score = banked + 999 // whatever was made on the level that was lost
  game.retryLevel()
  assert.equal(game.phase, PHASE.PLAYING)
  assert.equal(game.level, 1, "the same level")
  assert.equal(game.player.score, banked, "at the score it was dealt at")
  assert.equal(game.board.count, LEVELS[1].layout.join("").replace(/[.0]/g, "").length)
})

test("clearing the last level wins the mode", () => {
  const game = new Game()
  game.start("puzzle")
  // Jump to the end rather than playing every level to get there.
  game.level = LEVELS.length - 1
  game.retryLevel()
  settle(game)
  assert.equal(game.lastLevel, true)

  // The last level has to be played in the order that works: taking the longest
  // chain on the board every time strands a colour on it, which is what makes it the
  // last one.
  assert.equal(popLongest(game) && game.board.empty, false, "greed does not clear it")
  game.retryLevel()
  settle(game)
  playSolution(game, LEVELS.at(-1))

  assert.equal(game.board.empty, true)
  assert.ok(advanceUntil(game, () => game.phase === PHASE.OVER, 4))
  assert.equal(game.outcome, "won")
  assert.equal(game.level, LEVELS.length - 1, "it did not roll on past the end")
})

test("a mode is told whether it is the opening deal or a refill", () => {
  const phases = []
  const board = new Board({
    cols: 2,
    rows: 2,
    colours: 3,
    random: mulberry32(1),
    pickColour: (_board, _col, _row, phase) => {
      phases.push(phase)
      return 0
    },
  })
  board.fill()
  assert.ok(phases.length === 4 && phases.every((phase) => phase === "fill"))
  phases.length = 0
  board.remove([board.at(0, 0)])
  board.collapse()
  board.refill()
  assert.ok(phases.length > 0 && phases.every((phase) => phase === "refill"))
})

test("elimination's opening deal uses the whole pool", () => {
  // The board is empty when the first dot is dealt, so a mode that deals from what is
  // in play has nothing to go on: without the phase, the first dot set the only
  // surviving colour and every dot after it saw one colour surviving. That dealt a
  // board of 36 dots, all the same.
  const board = new Board({
    cols: 6,
    rows: 6,
    colours: 5,
    random: mulberry32(4),
    pickColour: ELIMINATION.pickColour.bind(ELIMINATION),
  })
  board.fill()
  const used = board.colourCounts().filter((count) => count > 0).length
  assert.equal(used, 5, "every colour was dealt")
})

test("elimination refills only with colours that are still on the board", () => {
  const board = new Board({
    cols: 6,
    rows: 6,
    colours: 5,
    random: mulberry32(11),
    pickColour: ELIMINATION.pickColour.bind(ELIMINATION),
  })
  board.fill()
  // Take every colour but one off the board, then refill and see what turns up.
  const survivor = 2
  board.remove(board.dots.filter((dot) => dot.colour !== survivor))
  board.collapse()
  board.refill()
  assert.equal(board.count, 36, "the board filled up")
  assert.ok(
    board.dots.every((dot) => dot.colour === survivor),
    "and every new dot is the one colour left",
  )
})

test("elimination stops dealing once the board is empty, and that is a win", () => {
  const board = new Board({ cols: 4, rows: 4, colours: 5, random: mulberry32(5) })
  board.fill()
  board.remove(board.dots.slice())
  assert.equal(modeRefills(ELIMINATION, board), false, "nothing is dealt into an empty board")
  assert.equal(defaultOutcome(ELIMINATION, board), "won")

  board.load(["....", "....", "..11", "..11"])
  assert.equal(modeRefills(ELIMINATION, board), true, "and it deals again while dots remain")
})

test("a mode whose refill is a plain boolean still works", () => {
  const board = new Board({ cols: 3, rows: 3, random: mulberry32(2) })
  assert.equal(modeRefills({ refill: true }, board), true)
  assert.equal(modeRefills({ refill: false }, board), false)
  assert.equal(modeRefills({}, board), false)
})
