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
// The order is by measured difficulty as far as the last seven, rising from 2.0 to 11.8: see
// src/analysis.js for what that measure is made of, and tools/find-levels.mjs for how all but the
// first seven levels were found. The first three fall to taking the longest chain every time; the
// next nine have several clearing orders paying very differently; from the thirteenth exactly one
// order pays par and the obvious play misses it or strands the board.
//
// The last seven are arranged rather than sorted. Sorted, they run 11.97 to 13.26 without a pause,
// which is a wall to climb rather than an ending to play: so the three hardest are spread through
// them and the rest fall between, giving a swing between hard and harder that finishes on the
// hardest board in the game. They are all above everything before them, so the difficulty still
// only goes one way overall.
//
// No two levels next to each other have the same silhouette, at the end or anywhere else. There are
// three boards of thirty dots and two each of a couple of other shapes, and consecutively they read
// as the same puzzle again.
//
// Both of those are checked in test/levels.test.js, since neither survives being left to a sort.
//
// The three thirty-dot boards take a minute or two each to value, which is why what has been proved
// about a level is written down in data/verified-boards.json rather than worked out again on every
// run: see tools/verify-levels.mjs.
//
// Boards found and not shipped are at the foot of this file, commented out.

import { parse, unpack } from "../solver.js"

export const PUZZLE_COLS = 6
export const PUZZLE_ROWS = 7

// The board a level becomes: its layout with every column fallen. What the picker draws as a
// preview. Cached, since the picker asks for all of them on every frame it is open.
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
    name: "The wicket",
    par: 783,
    floor: 156,
    layout: [
      "......",
      "......",
      "3.21.1",
      "3.11.1",
      "3.41.1",
      "334455",
      "322555",
    ],
  },
  {
    name: "The quarry",
    par: 2681,
    floor: 150,
    layout: [
      "......",
      "......",
      "111112",
      "222442",
      "555442",
      "113342",
      "511142",
    ],
  },
  {
    name: "The ravine",
    par: 5370,
    floor: 161,
    layout: [
      "......",
      "1....2",
      "11..22",
      "111.22",
      "444222",
      "515233",
      "555233",
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
  {
    name: "Sally port",
    par: 2555,
    floor: 126,
    layout: [
      "......",
      "......",
      "1.11.3",
      "1.13.3",
      "1.33.3",
      "122333",
      "222223",
    ],
  },
  {
    name: "The chasm",
    par: 6340,
    floor: 131,
    layout: [
      "......",
      "3....2",
      "33..22",
      "133.22",
      "111112",
      "441122",
      "344122",
    ],
  },
  {
    name: "The slab",
    par: 4060,
    floor: 150,
    layout: [
      "......",
      "......",
      "111111",
      "555541",
      "335441",
      "335542",
      "332222",
    ],
  },
]

// Found and not shipped, for whenever the ladder wants more at the hard end.
//
// All of them mesa - thirty dots, flat topped - because that is the silhouette a long run of
// tools/find-levels.mjs was pointed at, and it is where the hardest boards are: more dots, more
// chains, more ways to go wrong several moves later. Two of that run went in as the last two levels;
// these are the rest of it. The ladder already ends with three of that shape, which is why they are
// here rather than on the end of it.
//
// The numbers are what the run measured and are not proved: nothing is shipped until
// tools/verify-levels.mjs has walked it and played an order that scores par, so re-measure before
// using one. Each takes about two minutes to judge.
//
// 12.97, par 4882, floor 180, 6 chains, 25/113 openings lose it silently, greed strands. Climbed from 75.
// prettier-ignore
// {
//   name: "?",
//   par: 4882,
//   floor: 180,
//   layout: [
//     "......",
//     "......",
//     "444431",
//     "114331",
//     "111222",
//     "112222",
//     "113322",
//   ],
// },
//
// 12.94, par 3650, floor 150, 6 chains, 14/77 openings lose it silently, greed strands. Climbed from 74.
// prettier-ignore
// {
//   name: "?",
//   par: 3650,
//   floor: 150,
//   layout: [
//     "......",
//     "......",
//     "444444",
//     "412211",
//     "413331",
//     "113331",
//     "122311",
//   ],
// },
//
// 12.09, par 6741, floor 180, 5 chains, 5/83 openings lose it silently, greed strands. Climbed from 76.
// prettier-ignore
// {
//   name: "?",
//   par: 6741,
//   floor: 180,
//   layout: [
//     "......",
//     "......",
//     "444113",
//     "244133",
//     "222233",
//     "221133",
//     "221122",
//   ],
// },
//
// 10.68, par 5623, floor 150, 4 chains, 29/117 openings lose it silently, greed 3743. Climbed from 73.
// prettier-ignore
// {
//   name: "?",
//   par: 5623,
//   floor: 150,
//   layout: [
//     "......",
//     "......",
//     "221133",
//     "221332",
//     "111322",
//     "111322",
//     "133322",
//   ],
// },
//
