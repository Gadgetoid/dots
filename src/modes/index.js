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
//   refill          whether popped dots are replaced
//   timeLimit       seconds, or 0 for a board that lasts as long as it lasts
//   specialChance   chance a new dot carries a powerup; see specials.js
//
// And the optional hooks:
//   pickColour(board, col, row)   what to deal into a cell, for a mode that cares
//   onSettled(board)              once the board has stopped moving. May return a
//                                 list of dots it changed, which the game will
//                                 make a noise and a wobble about.
//   outcome(board)                "won", "lost" or null, if the default is wrong

import { CLASSIC } from "./classic.js"
import { RUSH } from "./rush.js"
import { LONG_GAME } from "./long-game.js"
import { ENDLESS } from "./endless.js"
import { CLEAR_OUT } from "./clear-out.js"

export const GAME_MODES = [CLASSIC, RUSH, LONG_GAME, ENDLESS, CLEAR_OUT]

export const MODE_BY_ID = new Map(GAME_MODES.map((mode) => [mode.id, mode]))

export const modeById = (id) => MODE_BY_ID.get(id) || GAME_MODES[0]

// How a board is judged when a mode says nothing about it: a board that refills is
// lost when nothing matches, and one that does not is won by clearing it.
export function defaultOutcome(mode, board) {
  if (board.empty) {
    return mode.refill ? null : "won"
  }
  if (!board.moveAvailable()) {
    return "lost"
  }
  return null
}
