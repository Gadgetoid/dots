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
//
// There are two sets of them, and a player stuck on one can go and play the other: the button at the
// foot of the picker swaps between them. They are two ladders rather than one long one, each opening
// on a warm up and ending on the hardest board it has, and no board appears in both.
//
// `finale` is how many of a set's levels are arranged rather than sorted; see the head of levels.js
// for what that means and test/levels.test.js for what it is held to. It differs per set because it
// is a property of how that set's ending was built, not of the mode.
//
// `draft` marks a set still being built. Its boards are held to being real - clearable, proved,
// and honest about par - and not to being a finished ladder, since a ladder cannot climb until it
// has levels to climb. See test/levels.test.js.
//
// `minChain` is a set's own, where it plays at something other than the mode's. A set at a longer
// chain is not the same puzzle judged harder: the moves are a different set, so the traps, the best
// order and what a board pays all differ, and a colour is stranded by having fewer dots than a chain
// needs rather than by having one. Omitted, a set plays at whatever the mode does.

import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "./levels.js"
import { LEVELS_TWO } from "./levels-two.js"
import { LEVELS_THREE } from "./levels-three.js"

// The first set keeps the bare mode id as its progress key, because that is the key every player who
// has ever cleared a level already has one under. A set added later carries its own.
export const PUZZLE_SETS = [
  { id: "one", name: "Ramparts", levels: LEVELS, finale: 14, progress: "puzzle" },
  { id: "two", name: "Caverns", levels: LEVELS_TWO, finale: 12, progress: "puzzle:two" },
  {
    id: "three",
    name: "Thickets",
    levels: LEVELS_THREE,
    finale: 0,
    progress: "puzzle:three",
    minChain: 3,
    draft: true,
  },
]

export const PUZZLE = {
  id: "puzzle",
  name: "Puzzle",
  blurb: "Designed boards, cleared one after another",
  cols: PUZZLE_COLS,
  rows: PUZZLE_ROWS,
  minChain: 2,
  colours: 5,
  refill: false,
  // A level is only cleared by emptying it, so a colour left with one dot has already
  // decided the board and the level ends there.
  stranded: true,
  timeLimit: 0,
  specialChance: 0,
  // Slendro, in cents rather than semitones because it is not an equal-tempered
  // scale: five near-even steps that no piano can play. A designed board deserves the
  // most deliberate sound in the game.
  tuning: { root: "F3", scale: "slendro" },
  sets: PUZZLE_SETS,
  // The set a game opens on. Which set is being played lives on the Game, since it is a thing a
  // player chooses; this is only what `mode.levels` means to everything that has not been told
  // about sets.
  levels: LEVELS,
}
