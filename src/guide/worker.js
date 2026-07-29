// Working out a level's solution, off the page's thread.
//
// The guide reads its solutions out of data/verified-boards.json, so this is only asked for a
// board that file does not cover: one that has been drawn since it was written, or all of them
// when the measure has changed and none of what it says still counts. That makes this the slow
// path by design - valuing every position reachable from a thirty dot board is a minute or two -
// and the reason it is not on the page's own thread.
//
// Two answers, in order of preference: an order that scores par, and failing that an order that
// merely clears the board. The second is what a level too big to value in the time given gets,
// and the page says which one it is showing.

import { parRoute } from "../analysis.js"
import { solve } from "../solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { PUZZLE } from "../modes/puzzle.js"
import { CONFIG } from "../config.js"

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

// Half of what the level test allows itself. A page is not a test suite: a reader who has opened
// a spoiler is watching a spinner, and a route that clears the board now beats the best route in
// two minutes.
const BUDGET = 20000000

const asPairs = (route) => route.map((chain) => chain.map((cell) => [cell.col, cell.row]))

self.onmessage = (event) => {
  const { index, layout } = event.data
  const started = Date.now()

  const best = parRoute(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, BUDGET)
  if (best) {
    self.postMessage({
      index,
      route: asPairs(best.route),
      par: true,
      took: Date.now() - started,
    })
    return
  }

  const found = solve(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain)
  self.postMessage({
    index,
    route: found.solved ? asPairs(found.sequence) : null,
    par: false,
    took: Date.now() - started,
  })
}
