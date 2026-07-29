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

  // Whether it can be cleared, first and separately. Finding one order that empties the board
  // proves it, and finding one is quick: it stops at the first, where working out par has to
  // value every position there is. So the answer that matters most is the one always given,
  // even where the rest of it cannot be worked out in time.
  const found = solve(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, 300000)
  const judged = analyse(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: 8,
    budget: 3000000,
  })
  self.postMessage({
    edit,
    found: {
      ...judged,
      // A proof beats a search that ran out of room: solve found a way through, so it clears
      // whatever the exhaustive walk managed to establish.
      clearable: found.solved ? true : judged.clearable,
    },
    solution: found.sequence,
    took: Date.now() - started,
  })
}
