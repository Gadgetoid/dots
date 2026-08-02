// Where the guide's solutions come from, and what it does before believing one.
//
// An order that scores par has already been worked out for every shipped level, by
// tools/verify-levels.mjs, and written to data/verified-boards.json against the board's own
// identity and a fingerprint of what judged it. So the page fetches that rather than searching:
// the largest levels take a minute or two to value and nobody waits that long for a spoiler.
//
// Two things follow from reading a file instead of computing:
//
//   - the page checks what it read. Every route is replayed here against the same rules the game
//     scores by - one colour, cardinal neighbours, no dot twice, and the columns collapsing after
//     each pop - and the total is compared with the level's par. A route that does not clear the
//     board or does not reach par is not shown as one that does.
//   - a level the file does not cover is worked out in a worker instead. That is what happens to a
//     board that has been edited but not re-verified, or to the whole set when the fingerprint
//     says the measure has changed since the file was written.

import { CONFIG } from "../config.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { PUZZLE, PUZZLE_SETS } from "../modes/puzzle.js"
import { measureFingerprint, provedKey } from "../analysis.js"
import { parse, unpack, without, isEmpty, coloursIn } from "../solver.js"

// What the game pays, in the shape the solver and the analysis want it. The same object
// tools/verify-levels.mjs hands them, for the same reason: so nothing here can drift from what
// the game actually scores.
export const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

export const FINGERPRINT = measureFingerprint(SCORING)

// Columns as letters and rows counted from the top, so a move can be written down: the top left
// cell is A1. Chess notation upside down, which is the way a board is read on a screen.
const COLUMN_NAMES = "ABCDEFGH"
export const cellName = (cell) => `${COLUMN_NAMES[cell.col]}${cell.row + 1}`

// The dot colours, in the order the palette lists them. Named here because the palette names
// them in prose and a guide has to say them out loud.
export const COLOUR_NAMES = ["purple", "blue", "teal", "red", "orange"]
export const colourName = (colour) => COLOUR_NAMES[colour % COLOUR_NAMES.length] ?? "?"

// What has already been proved about every board, as tools/verify-levels.mjs left it. Fetched
// relative to the page rather than to this module, since the scripts are published under a
// directory named after the commit and the data is not.
export async function provedBoards() {
  try {
    const response = await fetch(new URL("data/verified-boards.json", document.baseURI))
    if (!response.ok) {
      throw new Error(`${response.status}`)
    }
    const file = await response.json()
    return {
      boards: file.boards ?? {},
      // Whether what wrote the file is what would judge these boards now. A stale fingerprint
      // means every number in it was measured by something else, so none of it is used.
      current: file.fingerprint === FINGERPRINT,
    }
  } catch {
    return { boards: {}, current: false }
  }
}

// Which set holds a level, and so how long a chain has to be on it. Levels are unique across the
// sets - there is a test for it - so the level itself is enough to say. Built once, since every
// lookup below asks.
const CHAIN_OF = new Map(
  PUZZLE_SETS.flatMap((set) => set.levels.map((level) => [level, set.minChain ?? PUZZLE.minChain])),
)

export const levelId = (level) =>
  provedKey(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS), CHAIN_OF.get(level) ?? PUZZLE.minChain)

// What was proved about this level, or null where nothing was.
export function provenFor(proved, level) {
  if (!proved.current) {
    return null
  }
  return proved.boards[levelId(level)] ?? null
}

// How many dots a level holds, and of how many colours.
export function shapeOf(level) {
  const counts = coloursIn(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS))
  let dots = 0
  for (const count of counts.values()) {
    dots += count
  }
  return { dots, colours: counts.size }
}

// Play a route through the level and say what happened.
//
// This is the check on everything below it: a route is a list of chains and nothing about it is
// taken on trust. Each chain has to be one the game would accept - two or more dots of one
// colour, each beside the last, none of them twice - and the board has to be empty at the end.
// What comes back is what the player would see, move by move, with the multiplier in hand and
// the running score.
export function replay(level, route) {
  const cols = PUZZLE_COLS
  const rows = PUZZLE_ROWS
  let position = parse(level.layout, cols, rows)
  let multiplier = 1
  let score = 0
  const moves = []
  for (const chain of route) {
    const cells = chain.map(([col, row]) => ({ col, row }))
    const grid = unpack(position, cols, rows)
    const colour = grid[cells[0].col + cells[0].row * cols]
    if (!legal(cells, grid, cols, rows, colour)) {
      return null
    }
    const scored = CONFIG.chainScore(cells.length) * multiplier
    score += scored
    moves.push({ cells, colour, multiplier, scored, running: score })
    multiplier = SCORING.multiplierAfter(multiplier, cells.length)
    position = without(
      position,
      cells.map((cell) => cell.col + cell.row * cols),
      cols,
      rows,
    )
  }
  return { moves, score, cleared: isEmpty(position) }
}

function legal(cells, grid, cols, rows, colour) {
  if (cells.length < PUZZLE.minChain || colour < 0) {
    return false
  }
  const taken = new Set()
  for (const [index, cell] of cells.entries()) {
    if (cell.col < 0 || cell.row < 0 || cell.col >= cols || cell.row >= rows) {
      return false
    }
    const at = cell.col + cell.row * cols
    if (taken.has(at) || grid[at] !== colour) {
      return false
    }
    taken.add(at)
    if (index > 0) {
      const before = cells[index - 1]
      const apart = Math.abs(before.col - cell.col) + Math.abs(before.row - cell.row)
      if (apart !== 1) {
        return false
      }
    }
  }
  return true
}

// A level's solution, worked out somewhere that is not the page's own thread.
//
// One request at a time, in the order they were asked for: this is the slow path, taken only for
// a board the proved file does not cover, and two of them at once would leave the page fighting
// itself for a core.
export function createSolver() {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
  const waiting = new Map()
  const queue = []
  let busy = false

  const next = () => {
    if (busy || queue.length === 0) {
      return
    }
    busy = true
    const { key, layout } = queue.shift()
    worker.postMessage({ index: key, layout })
  }

  worker.onmessage = (event) => {
    busy = false
    const pending = waiting.get(event.data.index)
    waiting.delete(event.data.index)
    if (pending) {
      pending.resolve(event.data)
    }
    next()
  }

  return {
    // The route for this level, and whether it is one that scores par or merely one that clears
    // the board. A level too big to value in the time given still gets a solution, labelled as
    // not the best one.
    solve(key, layout) {
      const already = waiting.get(key)
      if (already) {
        return already.promise
      }
      let resolve
      const promise = new Promise((settle) => {
        resolve = settle
      })
      waiting.set(key, { resolve, promise })
      queue.push({ key, layout })
      next()
      return promise
    },
  }
}
