// Verify the shipped levels the slow way and write down what was proved.
//
// Every answer about a level is exactly computable and none of it is cheap: the largest is thirty
// dots and takes about a minute to value, twice over, since par is both computed and then proved
// reachable by finding an order that scores it. Thirty levels of that is minutes, and it grows with
// the ladder - which is no way to spend every CI run on data that has not changed.
//
// So this does the work once and records it in data/verified-boards.json, against the board's own
// identity and a fingerprint of what did the judging. The level test reads that: a level whose board
// and fingerprint are both known is taken as proved, and anything else is walked there and then. See
// test/levels.test.js for what stops the cache being believed forever.
//
//   node tools/verify-levels.mjs            # verify anything not already proved, and write it down
//   node tools/verify-levels.mjs --all      # re-verify everything from scratch
//   node tools/verify-levels.mjs --check    # verify nothing; say what is missing, and exit 1 if any
//
// The file is written as each board is proved, so a run stopped part way through keeps what it got
// to and the next one carries on from there. See `save`.
//
// Run it after adding a level or after anything that changes what the analysis returns - which means
// bumping MEASURE in src/analysis.js, since a cache cannot notice that a bug was fixed.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { analyse, parRoute, measureFingerprint } from "../src/analysis.js"
import { parse, boardId } from "../src/solver.js"
import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"
import { PUZZLE } from "../src/modes/puzzle.js"
import { CONFIG } from "../src/config.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const CACHE = path.join(ROOT, "data", "verified-boards.json")

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

export function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"))
  } catch {
    return { fingerprint: null, boards: {} }
  }
}

// Write the file, as each board is proved rather than once at the end. A board can take ten
// minutes, so a run that is stopped or killed part way through should keep what it has already
// proved.
//
// Two things this has to be careful about. It merges with what is on disk rather than replacing
// it, so a second run proving other boards at the same time does not lose them - and the run's own
// answers win, since they are the fresher of the two. And it writes through a temporary file in
// the same directory, so an interrupted write cannot leave a half a file behind: renaming over the
// old one either happens or does not, where writing over it in place has a middle where the file
// is neither. A corrupt cache reads as no cache, which is every board proved again.
//
// `live` is the boards the ladder uses, in the order it plays them.
function save(fingerprint, boards, live) {
  const onDisk = loadCache()
  const merged =
    onDisk.fingerprint === fingerprint ? { ...onDisk.boards, ...boards } : { ...boards }
  // Written in ladder order, which does two things at once. A board the ladder no longer uses is
  // left out, so the file is what the ladder is and not a history of it. And the file is the same
  // file however the run arrived at it: written in the order boards were proved, one board
  // re-proved on its own would move to the end and the whole file would read as changed.
  const kept = {}
  for (const id of live) {
    if (merged[id]) {
      kept[id] = merged[id]
    }
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  const partial = `${CACHE}.${process.pid}`
  fs.writeFileSync(partial, `${JSON.stringify({ fingerprint, boards: kept }, null, 1)}\n`)
  fs.renameSync(partial, CACHE)
  return kept
}

// A board is proved if it is in the cache under the fingerprint that is current.
export function provenBoard(cache, layout) {
  const wanted = measureFingerprint(SCORING, PUZZLE.minChain)
  if (cache.fingerprint !== wanted) {
    return null
  }
  return cache.boards[boardId(parse(layout, PUZZLE_COLS, PUZZLE_ROWS))] ?? null
}

// Everything worth writing down about one level, all of it proved rather than assumed: par is
// computed, and then an order that scores it is found and its total checked against it.
function verify(level) {
  const found = analyse(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: 600,
    budget: 200000000,
  })
  if (found.clearable !== true || !found.exact || !found.statsExact) {
    throw new Error(
      `${level.name}: clearable ${found.clearable}, exact ${found.exact}, stats ${found.statsExact}`,
    )
  }
  const route = parRoute(level.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING)
  if (!route) {
    throw new Error(`${level.name}: no order scoring par could be found to prove it with`)
  }
  if (route.score !== found.par) {
    throw new Error(
      `${level.name}: par is ${found.par} and the best order found scores ${route.score}`,
    )
  }
  return {
    name: level.name,
    par: found.par,
    floor: found.floor,
    difficulty: Number(found.difficulty.toFixed(2)),
    band: found.band,
    parPaths: found.parPaths,
    moves: found.moves,
    firstMoves: found.firstMoves,
    firstSilent: found.firstSilent,
    greedy: found.greedy.clears ? found.greedy.score : "strands",
    positions: found.positions,
    // The order that proves par, so the test can play it without finding it again - which is the
    // slow half. Cells as col,row pairs per chain.
    route: route.route.map((chain) => chain.map((cell) => [cell.col, cell.row])),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes("--all")
  const only = process.argv.includes("--check")
  const cache = all ? { fingerprint: null, boards: {} } : loadCache()
  const fingerprint = measureFingerprint(SCORING, PUZZLE.minChain)
  const stale = cache.fingerprint !== fingerprint
  if (stale && Object.keys(cache.boards).length > 0) {
    console.log("the measure has changed, so nothing already written down counts. Verifying all.")
  }
  const boards = stale ? {} : { ...cache.boards }
  const live = new Set(
    LEVELS.map((level) => boardId(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS))),
  )

  let missing = 0
  let verified = 0
  for (const [index, level] of LEVELS.entries()) {
    const id = boardId(parse(level.layout, PUZZLE_COLS, PUZZLE_ROWS))
    if (boards[id]) {
      // The name is the only thing that can change without the board changing.
      boards[id].name = level.name
      continue
    }
    missing++
    if (only) {
      console.log(`${String(index + 1).padStart(2)} ${level.name}: not proved`)
      continue
    }
    const started = Date.now()
    boards[id] = verify(level)
    verified++
    save(fingerprint, boards, live)
    console.log(
      `${String(index + 1).padStart(2)} ${level.name.padEnd(13)} par ${String(boards[id].par).padStart(5)} ` +
        `floor ${String(boards[id].floor).padStart(4)} diff ${boards[id].difficulty.toFixed(2).padStart(5)} ` +
        `proved in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
  }

  if (only) {
    console.log(missing === 0 ? `all ${LEVELS.length} proved` : `${missing} not proved`)
    process.exit(missing === 0 ? 0 : 1)
  }

  // Once more at the end, for the run that proved nothing and so never wrote: names may have
  // changed under boards that had not, and a level dropped from the ladder is dropped from here.
  const written = save(fingerprint, boards, live)
  console.log(
    `${verified} verified, ${Object.keys(written).length} in ${path.relative(ROOT, CACHE)}` +
      `${verified === 0 ? " (nothing had changed)" : ""}`,
  )
}
