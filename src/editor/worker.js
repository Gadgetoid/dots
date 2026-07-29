// The level analysis, off the page's thread.
//
// Judging a board means walking every position reachable from it, which takes up to a couple
// of seconds on a full one. On the page's own thread that is a couple of seconds where the
// editor does not repaint and a click does nothing, on every edit. Here it is a couple of
// seconds where the last answer stays on screen with a note that it is out of date.
//
// Only the newest request matters: a board that has been edited again while this was thinking
// is a board whose answer nobody wants, so each message carries the edit it belongs to and the
// page throws away anything that arrives for an older one.

import { analyse } from "../analysis.js"
import { solve } from "../solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { PUZZLE } from "../modes/puzzle.js"
import { CONFIG } from "../config.js"

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

self.onmessage = (event) => {
  const { layout, edit } = event.data
  const started = Date.now()
  const found = analyse(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: 6,
    budget: 2000000,
  })
  // One clearing order to show, where there is one: a level being authored is much easier to
  // trust when the editor can point at the sequence that empties it.
  const solution =
    found.clearable && !found.exhausted
      ? solve(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, 200000).sequence
      : []
  self.postMessage({ edit, found, solution, took: Date.now() - started })
}
