// The puzzle mode's levels.
//
// A layout is one string per board row, top row first: a digit is a colour (1 for
// the first of the theme's dot colours, as the original game's level data numbered
// them) and a dot is an empty cell. Board.load reads it and then lets it fall, so a
// layout can be drawn as a shape without every column being bottom-aligned by hand.
//
// Nothing refills, so every level has to be clearable - and whether it is depends on
// the order the chains are taken in, because each pop collapses the columns under it.
// That is the puzzle, and it is also easy to get wrong when authoring one:
// test/levels.test.js searches each layout for a sequence of chains that empties it
// and fails if it cannot find one. A level that does not survive that test is not
// shipped, so these are all provably clearable.
//
// Every layout must be exactly PUZZLE_COLS wide and PUZZLE_ROWS tall; the test
// checks that too.
export const PUZZLE_COLS = 6
export const PUZZLE_ROWS = 7

// A level is drawn rather than written, so the shape of it can be read here. Left to
// itself the formatter puts each layout on one line, where it is just a row of
// strings and the shape is gone.
// prettier-ignore
export const LEVELS = [
  {
    name: "WARM UP",
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
    name: "STACKS",
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
    name: "PYRAMID",
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
    name: "PILLARS",
    layout: [
      "......",
      "......",
      "1....2",
      "1.33.2",
      "1.33.2",
      "1....2",
      "114422",
    ],
  },
  {
    name: "ZIGZAG",
    layout: [
      "......",
      "......",
      "......",
      ".1..2.",
      ".11.22",
      "3311.2",
      "223311",
    ],
  },
  {
    name: "CHECKMATE",
    layout: [
      "......",
      "......",
      "1122..",
      "2211..",
      "..3344",
      "..4433",
      "112233",
    ],
  },
  {
    // The last one, and the only one that cannot be cleared by taking the longest
    // chain on the board every time: some of the orders that look right strand a
    // colour, and the solver had to back out of them to find one that does not.
    name: "THE LOCK",
    layout: [
      "......",
      ".1..2.",
      ".1..2.",
      ".1..2.",
      "331.22",
      "3311.2",
      "223311",
    ],
  },
]
