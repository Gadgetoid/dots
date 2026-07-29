// The puzzle mode's levels.
//
// A layout is one string per board row, top row first: a digit is a colour (1 for the first of
// the theme's dot colours, as the original game's level data numbered them) and a dot is an
// empty cell. Board.load reads it and then lets it fall, so a layout can be drawn as a shape
// without every column being bottom-aligned by hand - but these are all written already
// fallen, so what is drawn here is what appears on screen.
//
// Nothing refills, so every level has to be clearable - and whether it is depends on the order
// the chains are taken in, because each pop collapses the columns under it. That is the puzzle,
// and it is also easy to get wrong when authoring one: test/levels.test.js searches each layout
// for a sequence of chains that empties it and fails if it cannot find one. A level that does
// not survive that test is not shipped, so these are all provably clearable.
//
// Every layout must be exactly PUZZLE_COLS wide and PUZZLE_ROWS tall; the test checks that too.
//
// The two numbers on each level are exact rather than estimated, because the question is
// finite: a pop only ever takes dots off the board, so the positions reachable from a layout
// form a graph with no cycles and each one need only be valued once.
//
//   par     the most the level can score, over every order that clears it. What a star is
//           given for reaching.
//   floor   the least any clearing order scores. Where this is the par, every order that
//           clears pays the same: there is nothing to aim at, so no star is offered at all.
//           The first two levels are like that on purpose.
//
// Both are written down rather than worked out at run time, because the search takes about a
// second on the larger levels - and the test recomputes both, so a number that has drifted
// from its layout fails rather than quietly misleading a player.
//
// The order is by measured difficulty, which is its own question: see src/analysis.js, and
// tools/find-levels.mjs for how the later ones were found. It rises from 2.0 to 11.3 across the
// twenty. What the ladder is made of, roughly: the first three can be cleared for par by simply
// taking the longest chain on the board every time, the next nine have several orders that clear
// with very different scores, and from the thirteenth there is exactly one order that pays par
// and the obvious play either misses it or strands the board outright.

import { parse } from "../solver.js"

export const PUZZLE_COLS = 6
export const PUZZLE_ROWS = 7

// A level as the board it will actually be: the layout with every column fallen to the
// bottom, which is what the picker draws as its preview. Cached per level, since the picker
// asks for all twenty of them on every frame it is open.
const grids = new WeakMap()
export function levelGrid(level) {
  let grid = grids.get(level)
  if (!grid) {
    grid = parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS)
    grids.set(level, grid)
  }
  return grid
}

// A level is drawn rather than written, so the shape of it can be read here. Left to
// itself the formatter puts each layout on one line, where it is just a row of
// strings and the shape is gone.
// prettier-ignore
// A level is drawn rather than written, so the shape of it can be read here. Left to itself
// the formatter puts each layout on one line, where it is just a row of strings and the shape
// is gone.
// prettier-ignore
export const LEVELS = [
  {
    name: "Warm up",
    par: 24,
    floor: 24,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "......",
      "......",
      "112233",
    ],
  },
  {
    name: "Stacks",
    par: 81,
    floor: 81,
    layout: [
      "......",
      "......",
      "......",
      "......",
      "......",
      "1.2.3.",
      "112233",
    ],
  },
  {
    name: "Pyramid",
    par: 1120,
    floor: 64,
    layout: [
      "......",
      "......",
      "......",
      "..11..",
      ".1221.",
      ".1221.",
      "331133",
    ],
  },
  {
    name: "Pillars",
    par: 1176,
    floor: 72,
    layout: [
      "......",
      "......",
      "1....2",
      "1....2",
      "1.33.2",
      "1.33.2",
      "114422",
    ],
  },
  {
    name: "Bullseye",
    par: 1248,
    floor: 72,
    layout: [
      "......",
      "......",
      "......",
      ".1122.",
      ".1122.",
      ".1144.",
      "333344",
    ],
  },
  {
    name: "Zigzag",
    par: 1229,
    floor: 83,
    layout: [
      "......",
      "......",
      "......",
      ".1....",
      ".11.22",
      "331122",
      "223311",
    ],
  },
  {
    name: "The gate",
    par: 3717,
    floor: 126,
    layout: [
      "......",
      "......",
      "1.14.2",
      "1.14.2",
      "1.14.2",
      "111422",
      "222233",
    ],
  },
  {
    name: "Steps",
    par: 1265,
    floor: 129,
    layout: [
      "......",
      ".....1",
      "....11",
      "...333",
      "..2333",
      ".22332",
      "444222",
    ],
  },
  {
    name: "The comb",
    par: 2048,
    floor: 96,
    layout: [
      "......",
      "......",
      "5.2.1.",
      "5.2.1.",
      "552213",
      "544413",
      "544411",
    ],
  },
  {
    name: "Spire",
    par: 2184,
    floor: 118,
    layout: [
      "......",
      "..22..",
      "..11..",
      "..11..",
      ".4411.",
      "114332",
      "113332",
    ],
  },
  {
    name: "Towers",
    par: 1166,
    floor: 156,
    layout: [
      "......",
      "2....3",
      "2....3",
      "2....4",
      "115524",
      "115522",
      "115333",
    ],
  },
  {
    name: "Battlements",
    par: 609,
    floor: 99,
    layout: [
      "......",
      "......",
      "1.....",
      "1..2..",
      "433211",
      "423311",
      "423355",
    ],
  },
  {
    name: "Checkmate",
    par: 1408,
    floor: 88,
    layout: [
      "......",
      "......",
      "..22..",
      "..11..",
      "113344",
      "224433",
      "112233",
    ],
  },
  {
    name: "The lock",
    par: 2072,
    floor: 88,
    layout: [
      "......",
      ".1....",
      ".1..2.",
      ".1..2.",
      "331.22",
      "331122",
      "223311",
    ],
  },
  {
    name: "Undertow",
    par: 1706,
    floor: 91,
    layout: [
      "......",
      "......",
      "......",
      ".1.1.2",
      "11.1.2",
      "112222",
      "133222",
    ],
  },
  {
    name: "Deadeye",
    par: 1375,
    floor: 102,
    layout: [
      "......",
      "......",
      "......",
      ".3311.",
      ".3211.",
      ".3222.",
      "333222",
    ],
  },
  {
    name: "Portcullis",
    par: 1610,
    floor: 126,
    layout: [
      "......",
      "......",
      "5.22.3",
      "5.22.3",
      "5.42.3",
      "544133",
      "554113",
    ],
  },
  {
    name: "Bad steps",
    par: 1565,
    floor: 99,
    layout: [
      "......",
      ".....3",
      "....23",
      "...223",
      "..2223",
      ".11123",
      "111443",
    ],
  },
  {
    name: "The keep",
    par: 1966,
    floor: 129,
    layout: [
      "......",
      "......",
      "2.....",
      "2..3..",
      "222333",
      "112231",
      "111221",
    ],
  },
  {
    name: "The needle",
    par: 2024,
    floor: 88,
    layout: [
      "......",
      "..11..",
      "..11..",
      "..11..",
      ".4444.",
      "222222",
      "233211",
    ],
  },
]
