// Authored levels, cleared one after another. The mode the original browser game
// called puzzle, and the only one here whose board is designed rather than dealt.
//
// Nothing refills, so a level is a fixed set of dots and the order the chains are
// taken in is the whole game: every pop collapses the columns under it, so a chain
// that looks free can strand a colour with nothing to match. Clearing a level moves
// on to the next and keeps the score; running out of moves means retrying the level
// with the score it started on.
//
// The layouts and the promise that each one can actually be emptied are in levels.js.

import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "./levels.js"

export const PUZZLE = {
  id: "puzzle",
  name: "PUZZLE",
  blurb: "DESIGNED BOARDS. CLEAR EACH ONE",
  cols: PUZZLE_COLS,
  rows: PUZZLE_ROWS,
  minChain: 2,
  colours: 5,
  refill: false,
  timeLimit: 0,
  specialChance: 0,
  // Slendro, in cents rather than semitones because it is not an equal-tempered
  // scale: five near-even steps that no piano can play. A designed board deserves the
  // most deliberate sound in the game.
  tuning: { root: "F3", scale: "slendro" },
  levels: LEVELS,
}
