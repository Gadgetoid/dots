// The puzzle mode's third set: the one that plays at chains of three.
//
// **A stand-in.** Five boards drawn by hand to have something real behind the picker while the
// search runs; the ladder these become is fifty-two boards found by tools/find-levels.mjs at
// --chain 3. The set carries `draft`, which is what keeps the tests off its shape - see the head
// of test/levels.test.js for which of them a draft still has to pass, and it is all the ones
// about a board being real.
//
// Everything about how a layout is written, and what par and floor mean, is in levels.js.
//
// What differs here is that a pair is not a move. That changes the puzzle rather than the
// difficulty: the pairs are where most of a chain-of-two board's traps live, so these are tighter
// and read more plainly, and a colour is stranded by having fewer than three dots left rather than
// fewer than two. Windbreak is the whole of it in one board - a row of six where taking the middle
// three leaves a one and a two, both of them dead.
//
// A chain is a path through neighbouring cells, so a colour of four in a T cannot be taken in one:
// a path crosses the middle once and reaches two of the three arms. Four in an L or a square can.
// That is the first thing to know when drawing one of these by hand.

import { parse, unpack } from "../solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "./levels.js"

// prettier-ignore
export const LEVELS_THREE = [
  {
    name: "Sapling",
    par: 243,
    floor: 243,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "......",
      "...333",
      "111222",
    ],
  },
  {
    name: "Bramble",
    par: 243,
    floor: 243,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "1.2.3.",
      "1.2.3.",
      "1.2.3.",
    ],
  },
  {
    name: "Hedgerow",
    par: 499,
    floor: 418,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "2.....",
      "211...",
      "211333",
    ],
  },
  {
    name: "Coppice",
    par: 868,
    floor: 787,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "1.....",
      "11.2.3",
      "112233",
    ],
  },
  {
    name: "Windbreak",
    par: 1539,
    floor: 324,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "......",
      "111111",
      "222333",
    ],
  },
]

// The same preview cache levels.js keeps, for the same reason: the picker asks for every board's
// grid on every frame it is open.
const grids = new WeakMap()
export function levelThreeGrid(level) {
  let grid = grids.get(level)
  if (!grid) {
    grid = unpack(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
    grids.set(level, grid)
  }
  return grid
}
