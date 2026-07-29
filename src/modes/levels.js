// The puzzle mode's levels.
//
// A layout is one string per board row, top row first: a digit is a colour (1 for the first of
// the theme's dot colours, as the original game's level data numbered them) and a dot is an
// empty cell. ASCII so a level can be read and edited as the shape it is; `prettier-ignore` so
// the formatter does not flatten each one onto a single line. Every layout is exactly
// PUZZLE_COLS wide and PUZZLE_ROWS tall, and written already fallen, so what is drawn here is
// what appears on screen.
//
//   par     the most the level can score, over every order that clears it. A star is given for
//           reaching it.
//   floor   the least any clearing order scores. Where floor equals par, how the level is
//           played makes no difference to the score and no star is offered. The first two
//           levels are like that.
//
// Both are proved by playing: test/levels.test.js finds an order that scores par by walking the
// whole board, and plays it through the real game. That matters most for the six levels that split
// into independent puzzles, whose par is merged from the parts rather than walked - a construction,
// and one that deserves a witness.
//
// Nothing refills, so a level can only be cleared in some orders and not others: each pop
// collapses the columns under it. Both numbers are exact, and stored because the search that
// finds them takes about a second on the larger levels. test/levels.test.js recomputes both,
// proves each level can be emptied, and checks the order below.
//
// That order is by measured difficulty, which rises from 2.0 to 13.2 across the thirty: see
// src/analysis.js for what it is made of, and tools/find-levels.mjs for how all but the first
// seven were found. The first three fall to taking the longest chain every time; the next nine
// have several clearing orders paying very differently; from the thirteenth exactly one order
// pays par and the obvious play misses it or strands the board. The last is thirty dots and takes
// most of a minute to value, which is most of what the level test spends its time on.

import { parse, unpack } from "../solver.js"

export const PUZZLE_COLS = 6
export const PUZZLE_ROWS = 7

// The board a level becomes: its layout with every column fallen. What the picker draws as a
// preview. Cached, since the picker asks for all thirty on every frame it is open.
const grids = new WeakMap()
export function levelGrid(level) {
  let grid = grids.get(level)
  if (!grid) {
    grid = unpack(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
    grids.set(level, grid)
  }
  return grid
}

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
    name: "Buttress",
    par: 2450,
    floor: 126,
    layout: [
      "......",
      "1....4",
      "1....4",
      "1....4",
      "133234",
      "112234",
      "122334",
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
    name: "Watchtowers",
    par: 1168,
    floor: 156,
    layout: [
      "......",
      "1....1",
      "1....1",
      "1....1",
      "113331",
      "422233",
      "442444",
    ],
  },
  {
    name: "The iris",
    par: 1070,
    floor: 102,
    layout: [
      "......",
      "......",
      "......",
      ".3333.",
      ".3211.",
      ".2221.",
      "221111",
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
    name: "Riptide",
    par: 805,
    floor: 121,
    layout: [
      "......",
      "......",
      "......",
      ".3.1.2",
      "33.1.2",
      "223312",
      "222211",
    ],
  },
  {
    name: "Rampart",
    par: 2140,
    floor: 99,
    layout: [
      "......",
      "......",
      "2..1..",
      "2..1..",
      "211.22",
      "113322",
      "333333",
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
  {
    name: "Teeth",
    par: 1498,
    floor: 126,
    layout: [
      "......",
      "......",
      "2.4.2.",
      "2.4.2.",
      "224111",
      "254413",
      "255333",
    ],
  },
  {
    name: "The spindle",
    par: 1086,
    floor: 118,
    layout: [
      "......",
      "..11..",
      "..11..",
      "..44..",
      ".4433.",
      "114333",
      "222322",
    ],
  },
  {
    name: "Barbican",
    par: 1789,
    floor: 126,
    layout: [
      "......",
      "......",
      "1.22.3",
      "1.11.3",
      "3.13.3",
      "331323",
      "111222",
    ],
  },
  {
    name: "The descent",
    par: 1459,
    floor: 129,
    layout: [
      "......",
      ".....2",
      "....12",
      "...112",
      "..1111",
      ".22233",
      "222333",
    ],
  },
  {
    name: "The anvil",
    par: 6058,
    floor: 150,
    layout: [
      "......",
      "......",
      "111122",
      "144121",
      "444411",
      "422551",
      "335511",
    ],
  },
]
