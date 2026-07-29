// Report on the puzzle levels, or on a candidate being authored.
//
// Everything printed here comes from src/analysis.js, which is the same code the editor
// runs and the same solver the level test runs. This is the view of it that fits in a
// terminal while a level is being drawn.
//
//   node tools/levels.mjs                 # every shipped level
//   node tools/levels.mjs --file try.json # a file of { name, layout } or an array of them
//
// The columns:
//
//   par     the most any clearing order pays
//   floor   the least any clearing order pays. Equal to par means how it is played makes
//           no difference to the score, which is a level with nothing to aim at
//   paths   how many distinct orders reach par
//   traps   the share of all legal moves that strand the board
//   1st     how many of the opening moves strand it, out of how many there are
//   greedy  what taking the longest chain every time does: its score, or "strands"
//   diff    the difficulty band, 1 to 5

import fs from "node:fs"
import { analyse } from "../src/analysis.js"
import { describe as shapeOf } from "../src/solver.js"
import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"
import { PUZZLE } from "../src/modes/puzzle.js"
import { CONFIG } from "../src/config.js"

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : null
}

const file = arg("file")
const levels = file
  ? [].concat(JSON.parse(fs.readFileSync(file, "utf8")))
  : LEVELS.map((level, index) => ({ ...level, index }))

const pad = (value, width) => String(value).padStart(width)

console.log(
  "  # name             dots        par  floor paths traps  1st    greedy  diff  moves  states   took",
)

let failed = 0
for (const [index, level] of levels.entries()) {
  const started = Date.now()
  const found = analyse(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: Number(arg("seconds") || 20),
  })
  const took = ((Date.now() - started) / 1000).toFixed(1)
  const number = level.index === undefined ? index : level.index
  if (!found.clearable || found.exhausted) {
    failed++
    console.log(
      `${pad(number + 1, 3)} ${(level.name || "?").padEnd(16)} ${shapeOf(level, PUZZLE_COLS, PUZZLE_ROWS)} ` +
        `  ${found.timedOut ? `TOO BIG (${took}s, region of ${found.biggestRegion})` : found.exhausted ? "SEARCH EXHAUSTED" : "CANNOT BE CLEARED"}`,
    )
    continue
  }
  const greedy = found.greedy.clears ? pad(found.greedy.score, 9) : pad("strands", 9)
  console.log(
    `${pad(number + 1, 3)} ${(level.name || "?").padEnd(16)} ${shapeOf(level, PUZZLE_COLS, PUZZLE_ROWS)} ` +
      `${pad(found.par, 6)} ${pad(found.floor, 6)} ${pad(found.parPaths, 5)} ` +
      `${pad((found.trapRate * 100).toFixed(0) + "%", 5)} ${pad(`${found.firstSilent}/${found.firstMoves}`, 5)} ` +
      `${greedy} ${pad(found.band, 5)} ${pad(found.moves, 6)} ${pad(found.states, 7)} ${pad(took + "s", 6)}`,
  )
}

if (failed > 0) {
  console.error(`\n${failed} level(s) are not shippable`)
  process.exit(1)
}
