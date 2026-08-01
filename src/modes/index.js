// The game modes, as data.
//
// A mode is a plain object describing a board and how it is judged. Adding one is
// a file in here and a line in GAME_MODES; nothing in the game, the view or the
// input layer knows the difference between one mode and another.
//
// Every field:
//   id              key for settings and the best-score table; never change it
//   name            what the menu calls it
//   blurb           one line under the name, saying what makes it different
//   cols, rows      the grid. Fitted into the same region, so a big board has
//                   smaller dots and everything else is unchanged.
//   minChain        how many dots have to be linked before a chain can be popped
//   colours         how many of the theme's dot colours it deals from
//   refill          whether popped dots are replaced. Either a boolean or a
//                   predicate taking the board, for a mode that stops dealing.
//   stranded        whether a colour down to one dot ends the board. On a mode that
//                   never refills that dot can never be matched, so a mode played to
//                   empty the board has already lost; one not trying to empty it, like
//                   clear out, plays on.
//   timeLimit       seconds, or 0 for a board that lasts as long as it lasts
//   specialChance   chance a new dot carries a powerup; see specials.js
//   levels          authored boards, if the mode has them: clearing one moves on to
//                   the next and keeps the score. See levels.js for the format.
//   seeded          whether the board is dealt from a seed the player chooses, so the
//                   same code always gives the same dots. The game supplies the seed;
//                   see seed.js for what one is.
//   tuning          what the mode sounds like: { root, scale } naming an entry in
//                   scales.js, or "random" for a different voice every session.
//                   Omitted, the mode plays in the default tuning.
//
// And the optional hooks:
//   pickColour(board, col, row, phase)
//                                 what to deal into a cell, for a mode that cares.
//                                 `phase` is "fill" for the board a game opens on and
//                                 "refill" for topping one up afterwards, which a mode
//                                 dealing from what is on the board has to tell apart.
//   onSettled(board)              once the board has stopped moving. May return a
//                                 list of dots it changed, which the game will
//                                 make a noise and a wobble about.
//   outcome(board)                "won", "lost" or null, if the default is wrong

import { CLASSIC } from "./classic.js"
import { RUSH } from "./rush.js"
import { LONG_GAME } from "./long-game.js"
import { ENDLESS } from "./endless.js"
import { ELIMINATION } from "./elimination.js"
import { CLEAR_OUT } from "./clear-out.js"
import { PUZZLE } from "./puzzle.js"
import { SEEDED } from "./seeded.js"

export const GAME_MODES = [
  CLASSIC,
  RUSH,
  LONG_GAME,
  ENDLESS,
  ELIMINATION,
  CLEAR_OUT,
  PUZZLE,
  SEEDED,
]

export const MODE_BY_ID = new Map(GAME_MODES.map((mode) => [mode.id, mode]))

// The mode that plays from a seed, found by what it does: the game needs to name it to
// start it from a shared code, and nothing outside this file knows one mode from another.
export const SEEDED_MODE = GAME_MODES.find((mode) => mode.seeded) || null

export const modeById = (id) => MODE_BY_ID.get(id) || GAME_MODES[0]

// Whether a mode replaces what has been popped, which a mode may decide from the
// board rather than once and for all: the elimination mode stops dealing when there
// is nothing left to deal from.
export const modeRefills = (mode, board) =>
  typeof mode.refill === "function" ? mode.refill(board) : !!mode.refill

// How a board is judged when a mode says nothing about it. An empty board is a
// cleared one whatever the mode, since a mode that refills is topped up before it is
// ever judged; anything else with no chain left on it is lost.
export function defaultOutcome(mode, board) {
  if (board.empty) {
    return "won"
  }
  // A board that can no longer be emptied is finished, whatever is still matchable on it:
  // playing on to a board with no moves left costs the player the moves it takes to find
  // that out and pays nothing they could not already see. See Board.strandedDot.
  if (mode.stranded && board.strandedDot()) {
    return "stranded"
  }
  if (!board.moveAvailable()) {
    return "lost"
  }
  return null
}
