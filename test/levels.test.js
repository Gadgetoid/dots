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
import { PUZZLE, PUZZLE_SETS } from "../src/modes/puzzle.js"
import { solve, parse, unpack, columnGroups, EMPTY, describe as shapeOf } from "../src/solver.js"
import { analyse, parRoute } from "../src/analysis.js"
import { loadCache, provenBoard } from "../tools/verify-levels.mjs"
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
  for (const { name: set, levels } of SETS) {
    for (const [index, level] of levels.entries()) {
      const where = `${set} level ${index + 1}`
      void where
      assert.equal(level.layout.length, PUZZLE_ROWS, `level ${index + 1} has the right rows`)
      for (const row of level.layout) {
        assert.equal(row.length, PUZZLE_COLS, `level ${index + 1} row "${row}" is the right width`)
        assert.match(row, /^[.0-9]+$/, `level ${index + 1} row "${row}" only holds cells`)
      }
      assert.ok(level.name && level.name.length > 0, `level ${index + 1} is named`)
    }
  }
  assert.equal(PUZZLE.cols, PUZZLE_COLS)
  assert.equal(PUZZLE.rows, PUZZLE_ROWS)
})

test("no level uses a colour the mode does not deal", () => {
  for (const { levels } of SETS) {
    for (const [index, level] of levels.entries()) {
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
  }
})

test("every level can be cleared", () => {
  for (const { levels } of SETS) {
    for (const [index, level] of levels.entries()) {
      const result = solve(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain)
      assert.ok(
        result.solved,
        `level ${index + 1} "${level.name}" - ${shapeOf(level, PUZZLE_COLS, PUZZLE_ROWS)} - ` +
          `no clearing sequence found in ${result.states} positions`,
      )
      assert.ok(result.moves >= 3, `level ${index + 1} takes more than a couple of chains`)
    }
  }
})

// The scoring the game actually pays, handed to the search so the two cannot drift.
const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

// What is known about each level, from the cache where it has been proved and from a walk where it
// has not.
//
// Walking all of them takes minutes and grows with the ladder, on data that mostly has not changed,
// so tools/verify-levels.mjs does that work once and writes down what it proved - against the
// board's own identity and a fingerprint of the rules and weights that judged it. A level whose
// board and fingerprint are both in the file is taken as proved.
//
// Two things stop that being a way to believe a stale number forever:
//
//   - the fingerprint. Change what a chain pays, or how difficulty is weighed, and nothing in the
//     file counts. MEASURE in src/analysis.js covers the rest: bump it when a change could alter
//     what the analysis returns, since no fingerprint can notice that a bug was fixed.
//   - the board's identity. Edit a layout by one dot and it is a different board, so it is walked.
//
// Between them, a number can only be believed while both the board and the thing that judged it
// are the ones that produced it. What is not checked is that a board nobody has touched still
// holds, and it does: a layout does not become unclearable while nobody is looking.
const CACHE = loadCache()
// So walking some of them regardless is opt-in. Two is a couple of seconds on the early levels
// and several minutes if the day lands on one of the largest, which is a long wait on every run
// and on every CI build for a file that is not moving.
//
//   DOTS_REWALK_LEVELS=1 npm test
//
// Which two is chosen by the day, so daily runs get through the whole ladder from scratch in
// under a month. Worth turning on after a change to the search that the fingerprint cannot see;
// tools/verify-levels.mjs is the other way, and the thorough one.
const SAMPLED = process.env.DOTS_REWALK_LEVELS ? 2 : 0
const sampleFrom = Math.floor(Date.now() / 86400000) * SAMPLED

// Everything below is asked of every set of levels the mode holds, not just the one a game opens on:
// a second ladder is a second thing that can be drawn wrong. The mechanics further down stay with
// the first set, since what they are testing is the mode and not the boards.
const knownFor = (levels) => {
  const sampled = new Set(
    Array.from({ length: SAMPLED }, (_, at) => (sampleFrom + at) % levels.length),
  )
  return levels.map((level, index) => {
    const proved = sampled.has(index) ? null : provenBoard(CACHE, level.layout)
    // One shape whichever way the answer arrived, so nothing below has to care which. The cache holds
    // what was proved; the two derived from it - whether the score is forced, and what greed did - are
    // rebuilt rather than stored, since a stored copy of something derivable is a second thing to keep
    // in step.
    const shape = (known, extra) => ({
      ...known,
      forced: known.floor === known.par,
      greedy: {
        clears: known.greedy !== "strands",
        score: known.greedy === "strands" ? 0 : known.greedy,
      },
      ...extra,
    })
    if (proved) {
      return shape(proved, { fromCache: true })
    }
    // A walked level has no route written down, so the replay test finds one for it. The budget is
    // named rather than left to the default, which the largest boards are over: the two of thirty-two
    // dots reach nine million positions, and a walk that runs out of budget can say nothing exact.
    const found = analyse(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
      seconds: 300,
      budget: 20000000,
    })
    return shape(
      {
        par: found.par,
        floor: found.floor,
        difficulty: found.difficulty,
        band: found.band,
        parPaths: found.parPaths,
        moves: found.moves,
        firstMoves: found.firstMoves,
        firstSilent: found.firstSilent,
        greedy: found.greedy.clears ? found.greedy.score : "strands",
      },
      { exhausted: found.exhausted, statsExact: found.statsExact, fromCache: false },
    )
  })
}

// Each set with what is known about it, so a test can say which ladder it is talking about.
const SETS = PUZZLE_SETS.map((set) => ({ ...set, known: knownFor(set.levels) }))

test("every level has been proved, by the cache or here and now", () => {
  // A level nobody has verified is a level whose par is a guess. The tool writes them down; this is
  // what makes forgetting to run it a failure rather than a slow leak.
  for (const { levels, known } of SETS) {
    for (const [index, level] of levels.entries()) {
      assert.ok(
        known[index].fromCache || !known[index].exhausted,
        `level ${index + 1} "${level.name}" is neither in data/verified-boards.json under the ` +
          `current fingerprint nor walkable here: run node tools/verify-levels.mjs`,
      )
    }
  }
  const walked = SETS.flatMap((set) => set.known).filter((known) => !known.fromCache).length
  assert.ok(
    walked >= SAMPLED,
    `${SAMPLED} were to be walked whatever the cache says, and ${walked} were`,
  )
})

test("a board that is several puzzles side by side is only exact about par", () => {
  // Six full columns, each its own colour, so nothing in one can ever touch another: six
  // independent puzzles drawn side by side, and eight states a column makes a quarter of a million
  // for the board. It is the parts that say whether such a board can be cleared - see
  // partsClearable - while par and floor stay with the whole-board walk, because a part's chains
  // cannot be reordered freely and merging what each part can be cleared with therefore claims
  // orders that do not exist. So `decomposed` is reported only where the walk could not answer,
  // and here it can.
  const columns = Array.from({ length: PUZZLE_ROWS }, () =>
    Array.from({ length: PUZZLE_COLS }, (_, col) => String(col + 1)).join(""),
  )
  const found = analyse(columns, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: 60,
  })
  assert.equal(
    columnGroups(parse(columns, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS).groups,
    6,
    "it is six independent puzzles",
  )
  // One chain of seven per column, taken with the multiplier climbing all the way: 7^4 times
  // 1 + 2 + 3 + 4 + 5 + 6.
  assert.equal(found.par, 50421, "par is what walking it says it is")
  assert.equal(found.exact, true, "and the walk got to the end of it")
  assert.equal(found.clearable, true)
})

test("every level's par is the most it can actually score", () => {
  for (const { levels, known } of SETS) {
    for (const [index, level] of levels.entries()) {
      const found = known[index]
      if (!found.fromCache) {
        assert.equal(found.exhausted, false, `level ${index + 1} was searched to the end`)
        assert.equal(found.statsExact, true, `level ${index + 1} was counted, not estimated`)
      }
      assert.equal(
        level.par,
        found.par,
        `level ${index + 1} "${level.name}" is written down as ${level.par} and can score ` +
          `${found.par} (searched ${found.positions} positions)`,
      )
    }
  }
})

test("every level's floor is the least a clearing order scores", () => {
  for (const { levels: LEVELS, known: KNOWN } of SETS)
  // What says whether a level has anything to aim at: where the floor is the par, every order
  // that clears pays the same, and the picker offers no star for it.
  {
    for (const [index, level] of LEVELS.entries()) {
      assert.equal(
        level.floor,
        KNOWN[index].floor,
        `level ${index + 1} "${level.name}" is written down with a floor of ${level.floor} and ` +
          `the least a clearing order pays is ${KNOWN[index].floor}`,
      )
    }
  }
})

// The last stretch of a set is arranged rather than sorted; see the head of src/modes/levels.js.
// How many is a property of the set, since it is a property of how that set's ending was built.

test("the ladder climbs as far as the finale, and the finale is above all of it", () => {
  for (const { name: set, levels: LEVELS, known: KNOWN, finale: FINALE } of SETS) {
    const difficulty = KNOWN.map((known) => known.difficulty)
    const climb = difficulty.length - FINALE
    for (let index = 1; index < climb; index++) {
      assert.ok(
        difficulty[index] >= difficulty[index - 1],
        `level ${index + 1} "${LEVELS[index].name}" measures ${difficulty[index].toFixed(1)}, ` +
          `easier than the level before it at ${difficulty[index - 1].toFixed(1)}`,
      )
    }
    // The finale may swing about, but not back into the ladder: every one of it is harder than
    // everything before it, so the game only gets harder however the last seven are arranged.
    const highest = Math.max(...difficulty.slice(0, climb))
    for (let index = climb; index < difficulty.length; index++) {
      assert.ok(
        difficulty[index] > highest,
        `level ${index + 1} "${LEVELS[index].name}" measures ${difficulty[index].toFixed(1)}, ` +
          `which is not above the ${highest.toFixed(1)} the ladder reaches`,
      )
    }
    assert.ok(KNOWN[0].band === 1, `${set} opens on the gentlest band`)
    assert.ok(KNOWN.at(-1).band === 5, `and ${set} ends on the hardest`)
  }
})

test("the finale swings rather than climbing, and ends on the hardest board", () => {
  for (const { levels: LEVELS, known: KNOWN, finale: FINALE } of SETS) {
    // Sorted, the last fourteen run 11.97 to 14.25 without a pause, which is a wall rather than an
    // ending. So the hardest are spread through them: what this insists on is that the run is not
    // monotone - there are dips - and that the last level is the hardest in the game, since an
    // ending should be the peak and not the trough after one.
    const finale = KNOWN.slice(-FINALE).map((known) => known.difficulty)
    const dips = finale.filter((value, at) => at > 0 && value < finale[at - 1]).length
    assert.ok(
      dips >= 2,
      `the last ${FINALE} run ${finale.map((d) => d.toFixed(1)).join(", ")}, which has only ` +
        `${dips} step down in it: sorted, they are a wall to climb`,
    )
    const hardest = Math.max(...KNOWN.map((known) => known.difficulty))
    assert.equal(
      KNOWN.at(-1).difficulty,
      hardest,
      `the set ends on "${LEVELS.at(-1).name}" and its hardest board is ${hardest.toFixed(1)}`,
    )
  }
})

test("no two levels next to each other are the same shape", () => {
  // A silhouette is the column heights, which is what a board looks like before any of its colours
  // are read. Two of those in a row read as the same puzzle again - and a sort by difficulty puts
  // them together, since a shape's dot count largely decides how hard it measures.
  const shapeOfLevel = (level) => {
    const grid = unpack(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
    return Array.from(
      { length: PUZZLE_COLS },
      (_, col) =>
        Array.from({ length: PUZZLE_ROWS }, (_, row) => grid[col + row * PUZZLE_COLS]).filter(
          (cell) => cell !== EMPTY,
        ).length,
    ).join(",")
  }
  for (const { levels: LEVELS } of SETS) {
    const shapes = LEVELS.map(shapeOfLevel)
    for (let index = 1; index < shapes.length; index++) {
      assert.notEqual(
        shapes[index],
        shapes[index - 1],
        `levels ${index} "${LEVELS[index - 1].name}" and ${index + 1} "${LEVELS[index].name}" ` +
          `are both ${shapes[index]}`,
      )
    }
  }
})

test("the opening levels are warm ups and the rest are not", () => {
  // A warm up is a level where nothing can go wrong: no order strands the board, and every
  // order that clears pays the same. Two of those is a welcome; three would be a waste of the
  // player's time.
  for (const { name: set, known: KNOWN } of SETS) {
    const forced = KNOWN.map((known) => known.forced)
    assert.deepEqual(forced.slice(0, 2), [true, true], `${set} opens on two that ask nothing`)
    assert.equal(
      forced.slice(2).some(Boolean),
      false,
      `and every ${set} level after them pays differently depending on how it is played`,
    )
  }
})

test("the hard half has one best order, and the obvious play does not find it", () => {
  // What the later levels are for: a single order pays par, so there is something to find, and
  // taking the longest chain every time is not it.
  for (const { name: set, levels: LEVELS, known: KNOWN } of SETS) {
    const half = KNOWN.slice(LEVELS.length / 2)
    assert.ok(
      half.filter((found) => found.parPaths === 1).length >= 6,
      `at least six of ${set}'s back half have exactly one best order`,
    )
    assert.ok(
      half.filter((found) => !found.greedy.clears).length >= 6,
      `and at least six of them strand the board if played greedily`,
    )
    for (const [index, found] of KNOWN.entries()) {
      if (index >= 3) {
        assert.ok(
          found.greedy.score < found.par,
          `level ${index + 1} "${LEVELS[index].name}" pays par to greed, so there is nothing to work out`,
        )
      }
    }
  }
})

test("par is a target, not a formality: greed does not reach it", () => {
  // Taking the longest chain on the board every time is the obvious way to play, and on
  // at least one level it leaves score on the table - otherwise showing a target would
  // be telling the player nothing they could not get by not thinking.
  let missedOne = false
  for (const level of SETS.flatMap((set) => set.levels)) {
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
  for (const { name: set, levels } of SETS) {
    const counts = levels.map((level) => level.layout.join("").replace(/[.0]/g, "").length)
    assert.ok(counts[0] <= 8, `${set} opens on a handful of dots`)
    assert.ok(counts.at(-1) >= 20, `${set} ends on a full board`)
    // Not strictly monotonic - a level can be smaller and harder - but the trend has
    // to be upward, or the ramp is not a ramp.
    assert.ok(counts.at(-1) > counts[0] * 2)
  }
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
  assert.equal(rows[0].kind, "buttons")
  assert.equal(
    rows[0].options[0].action,
    "retry",
    "the first thing offered is another go at the level",
  )
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

test("clearing a level records it, unlocks the next and nothing else", () => {
  const game = new Game()
  game.start("puzzle")
  assert.equal(game.levelUnlocked(0), true, "the first is always open")
  assert.equal(game.levelUnlocked(1), false, "and the second is not")

  // Clear it by hand at exactly par, which is what a star is for.
  clearLevel(game, LEVELS[0].par)
  assert.deepEqual(game.levelBest(), { 0: LEVELS[0].par })
  assert.equal(game.levelCleared(0), true)
  assert.equal(game.levelUnlocked(1), true, "the next one opens")
  assert.equal(game.levelUnlocked(2), false, "and only the next one")
})

test("a star is for par, and only where par is worth reaching", () => {
  // The first level pays the same however it is played, so there is no star in it however
  // well it is cleared.
  const forced = new Game()
  forced.start("puzzle")
  clearLevel(forced, LEVELS[0].par)
  assert.equal(forced.levelContested(0), false, "every order pays the same")
  assert.equal(forced.levelStarred(0), false, "so there is no star to give")

  // The third pays anywhere from its floor to its par, so there is something to reach for.
  const reached = { puzzle: { 0: LEVELS[0].par, 1: LEVELS[1].par } }

  const short = new Game()
  short.progress = reached
  short.start("puzzle", { level: 2 })
  assert.equal(short.levelContested(2), true)
  clearLevel(short, LEVELS[2].par - 1)
  assert.equal(short.levelStarred(2), false, "one short of par is no star")

  const exact = new Game()
  exact.progress = reached
  exact.start("puzzle", { level: 2 })
  clearLevel(exact, LEVELS[2].par)
  assert.equal(exact.levelStarred(2), true, "and par is")

  // A worse run afterwards does not take it away: what is kept is the best.
  exact.start("puzzle", { level: 2 })
  clearLevel(exact, LEVELS[2].floor)
  assert.equal(exact.levelBest()[2], LEVELS[2].par, "the record is the best, not the last")
  assert.equal(exact.levelStarred(2), true)
})

test("no board is in more than one set, and no name either", () => {
  // Two ladders are only two ladders if they are made of different boards. Mirrors and recolourings
  // count as the same board: a mirrored board plays identically, and swapping two colours over is
  // the same puzzle wearing different paint.
  const fallen = (layout) =>
    Array.from({ length: PUZZLE_ROWS }, (_, row) =>
      Array.from({ length: PUZZLE_COLS }, (_, col) => {
        const grid = unpack(parse(layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
        const cell = grid[col + row * PUZZLE_COLS]
        return cell === EMPTY ? "." : String(cell)
      }).join(""),
    )
  const renamed = (rows) => {
    const seen = new Map()
    return rows
      .map((row) =>
        [...row]
          .map((cell) =>
            cell === "."
              ? "."
              : (seen.has(cell) ? seen : seen.set(cell, String(seen.size))).get(cell),
          )
          .join(""),
      )
      .join("|")
  }
  const identity = (layout) => {
    const rows = fallen(layout)
    const mirrored = rows.map((row) => [...row].reverse().join(""))
    const [a, b] = [renamed(rows), renamed(mirrored)].sort()
    return a < b ? a : b
  }

  const boards = new Map()
  const names = new Map()
  for (const set of SETS) {
    for (const level of set.levels) {
      const board = identity(level.layout)
      const already = boards.get(board)
      assert.equal(
        already,
        undefined,
        `${set.name}'s "${level.name}" is the same board as ${already}, mirrors and colours aside`,
      )
      boards.set(board, `${set.name}'s "${level.name}"`)
      const clash = names.get(level.name)
      // Names have to be unique across the sets as well, because a ?puzzle= link names a level and
      // has no set of its own: two levels of one name would make such a link ambiguous.
      assert.equal(clash, undefined, `"${level.name}" is the name of a level in ${clash} too`)
      names.set(level.name, set.name)
    }
  }
})

test("the picker offers the other set, and swapping does not disturb it", () => {
  const game = new Game()
  game.start("puzzle")
  game.page = "levels"
  const foot = () => {
    const rows = game.menuRows()
    return rows[rows.length - 1].options
  }
  assert.equal(game.levelSet.name, PUZZLE_SETS[0].name, "it opens on the first set")
  assert.equal(foot()[1].label, PUZZLE_SETS[1].name, "and the picker's spare slot offers the other")

  game.menuIndex = game.menuRows().length - 1
  game.menuOption = 1
  game.menuConfirm()
  assert.equal(game.levelSet.name, PUZZLE_SETS[1].name, "pressing it swaps")
  assert.equal(game.levels[0].name, PUZZLE_SETS[1].levels[0].name, "and the grid is the other set")
  assert.equal(foot()[1].label, PUZZLE_SETS[0].name, "and the button now offers the way back")

  game.menuIndex = game.menuRows().length - 1
  game.menuOption = 1
  game.menuConfirm()
  assert.equal(game.levelSet.name, PUZZLE_SETS[0].name, "and again swaps back")
})

test("the two sets remember how far they got apart from each other", () => {
  // The first set keeps the bare mode id, because that is the key every player who has ever cleared
  // a level already has one under. Losing that would be losing everyone's progress.
  const game = new Game()
  game.start("puzzle")
  assert.equal(game.progressKey(), "puzzle", "the first set keeps the key it always had")
  game.progress = { puzzle: { 0: 24, 1: 81 } }
  assert.equal(game.levelUnlocked(2), true, "two cleared in the first set opens the third")

  game.settings.levelSet = 1
  assert.notEqual(game.progressKey(), "puzzle", "the second set keeps its own")
  assert.equal(game.levelUnlocked(1), false, "and knows nothing of the first set's progress")
  assert.equal(game.furthestLevel(), 0, "so it opens at its own beginning")

  game.progress = { ...game.progress, [game.progressKey()]: { 0: 24 } }
  assert.equal(game.levelUnlocked(1), true, "clearing one there opens the next there")
  game.settings.levelSet = 0
  assert.equal(game.levelUnlocked(2), true, "and the first set is where it was left")
})

test("a link names a level in either set, and opens the set that holds it", () => {
  // A ?puzzle= link carries a name and no set, so it has to be looked for in both: a link written
  // before there was a second set still opens the board it names, and one naming a board in the
  // other set takes the player there rather than being refused.
  const cleared = (levels) => Object.fromEntries(levels.map((_, at) => [at, 1]))
  const both = {
    puzzle: cleared(PUZZLE_SETS[0].levels),
    "puzzle:two": cleared(PUZZLE_SETS[1].levels),
  }
  const open = (search, from) => {
    const game = new Game()
    game.progress = both
    game.settings.levelSet = from
    game.settings.mode = "puzzle"
    game.remembered = true
    game.launch(search)
    return game
  }
  const second = PUZZLE_SETS[1].levels[0].name
  const away = open(`?puzzle=${second.toLowerCase()}`, 0)
  assert.equal(away.levelSet.name, PUZZLE_SETS[1].name, "a name from the second set swaps to it")
  assert.equal(away.currentLevel.name, second, "and opens that board")

  const back = open(`?puzzle=${PUZZLE_SETS[0].levels[0].name.toLowerCase().replace(/ /g, "-")}`, 1)
  assert.equal(back.levelSet.name, PUZZLE_SETS[0].name, "and a name from the first swaps back")

  // A number is a position, so it means the ladder in front of you.
  const numbered = open("?puzzle=1", 1)
  assert.equal(
    numbered.levelSet.name,
    PUZZLE_SETS[1].name,
    "a number stays on the set being played",
  )
  assert.equal(numbered.currentLevel.name, second)
})

test("a level that has not been reached cannot be started", () => {
  const game = new Game()
  game.start("puzzle", { level: 9 })
  assert.equal(game.level, 0, "asking for a locked level opens the first instead")

  game.progress = { puzzle: Object.fromEntries(LEVELS.slice(0, 9).map((level, i) => [i, 1])) }
  game.start("puzzle", { level: 9 })
  assert.equal(game.level, 9, "and once it has been reached, it opens")
})

test("the picker locks what has not been reached and opens where the player left off", () => {
  const game = new Game()
  game.progress = { puzzle: { 0: 24, 1: 81, 2: 100 } }
  game.start("puzzle")
  game.page = "levels"
  const rows = game.menuRows()
  const grid = rows.find((row) => row.layout === "levels")
  assert.equal(grid.options.length, LEVELS.length, "one cell per level")
  assert.deepEqual(
    grid.options.map((cell) => cell.locked),
    LEVELS.map((level, index) => index > 3),
    "everything past the one after the last cleared is locked",
  )

  // The cursor lands on the furthest one open, which is the one a player came back for.
  game.menuIndex = rows.indexOf(grid)
  game.menuOption = 0
  game.menuMove(-1)
  game.menuMove(1)
  assert.equal(grid.options[game.menuOption].locked, false, "and never on a locked cell")
})

// Clear whatever level a game is on, paying `scored` for it. The board is emptied rather than
// played, since what is being checked is what the game does about it.
function clearLevel(game, scored) {
  const level = game.level
  game.player.score = game.levelStartScore + scored
  game.board.remove(game.board.dots.slice())
  for (let i = 0; i < 240; i++) {
    game.advance(1 / 60)
  }
  assert.equal(game.levelCleared(level), true, `level ${level + 1} was recorded`)
}

test("par is reachable: an order that scores it can be played through the game", () => {
  // The strongest check there is on par, and the only one that covers how it was worked out: find an
  // order that scores it, and play that order through the real game.
  //
  // It has already earned its keep. par used to be built for a board that splits into independent
  // parts by merging what each part can be cleared with, which claimed 2577 on one level where no
  // real order beats 2450 - a part's chains cannot be reordered freely, and the merge assumed they
  // could. Nothing but playing it would have caught that.
  //
  // Finding the order is the slow half, so a proved level plays the order the tool wrote down, and
  // only a level being walked here has one found for it.
  for (const { levels: LEVELS, known: KNOWN, progress } of SETS) {
    for (const [index, level] of LEVELS.entries()) {
      const known = KNOWN[index]
      let route =
        known.route && known.route.map((chain) => chain.map(([col, row]) => ({ col, row })))
      if (!route) {
        const found = parRoute(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING)
        assert.ok(found, `level ${index + 1} "${level.name}" could be walked`)
        assert.equal(
          found.score,
          level.par,
          `level ${index + 1} "${level.name}": the walk reaches ${found.score}, par says ${level.par}`,
        )
        route = found.route
      }

      const game = new Game()
      // Unlocked up to here in the set being replayed, and the game put on that set, since a level is
      // an index into whichever set is up.
      game.settings.levelSet = SETS.findIndex((set) => set.progress === progress)
      game.progress = {
        [progress]: Object.fromEntries(LEVELS.slice(0, index).map((_, at) => [at, 1])),
      }
      game.start("puzzle", { level: index })
      settle(game)
      const before = game.player.score
      for (const cells of route) {
        playChain(game, cells)
      }
      assert.equal(game.board.count, 0, `level ${index + 1} "${level.name}" was emptied`)
      assert.equal(
        game.player.score - before,
        level.par,
        `level ${index + 1} "${level.name}" paid ${game.player.score - before} for a par order`,
      )
    }
  }
})
