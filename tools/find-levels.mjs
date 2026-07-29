// Search for puzzle levels worth shipping. Runs for as long as you let it.
//
// The shapes here are drawn by hand, because a silhouette is the part a player looks at and no
// search knows what looks good. The colours are what gets searched, because the qualities a level
// needs cannot be seen in a layout: whether it can be cleared at all, whether how you play it
// changes what it pays, whether the obvious play is wrong, and whether the traps in it are the kind
// anyone would actually fall into.
//
// That last one is why this exists rather than hand-authoring levels. Every one of the original
// seven turns out to have no silent traps at all: every opening that loses is one that leaves a dot
// sitting on its own where a player can see it. Traps that do not announce themselves come out of
// the collapse several moves deep, and guessing which arrangement has them by eye is hopeless.
//
//   node tools/find-levels.mjs --out found
//   node tools/find-levels.mjs --out found --min 12.5 --seconds 120
//   node tools/find-levels.mjs --out found --shape mesa --from 40000
//
// | flag        | what it does                                                         |
// | ----------- | -------------------------------------------------------------------- |
// | --out DIR   | a directory; one file per find, written the moment it is found        |
// | --min N     | keep boards measuring at least this hard (default 11.5)               |
// | --seconds N | how long one board may be judged for (default 45)                     |
// | --tries N   | stop after this many starting points (default 0, meaning never)       |
// | --workers N | how many at once (default half the cores)                             |
// | --shape S   | only this silhouette, or "all" for a broad run over all of them       |
// | --from N    | start every shape here, overriding what state.json remembers          |
// | --show N    | print starting point N and stop, to see or reproduce one              |
// | --maxdots N | skip silhouettes with more dots than this (default 26)                |
// | --duty N    | work only N percent of the time, to run cooler (default 100)          |
// | --minutes N | stop after this long (default 0, meaning never)                       |
// | --per-shape N | keep at most this many finds of one silhouette (default 4)          |
//
// Three ways to stop it, all of them clean - the boards in hand are finished, the summary is
// written, and the number to carry on from is printed:
//
//   touch found/stop     from another terminal, whenever
//   Ctrl-C               drops that same file rather than killing the run
//   --minutes N          decides in advance
//
// Ctrl-C twice stops without waiting, and then the resume point is whatever the summary last said.
//
// Boards already in the ladder are skipped: data/verified-boards.json holds their identities, and a
// climb that wandered onto one would spend its leash re-proving a board that has been proved.
// | --steps N   | steps without an improvement before starting again (default 20)       |
// | --apart N   | how many cells a find must differ from every other find by (default 4)|
//
// It does not enumerate colourings, and could not: the smallest silhouette here has 3e10 of them
// and the biggest 2e20, which even at a thousand judged a second - a thousand times faster than
// they can be judged - is a year and six billion years. Drawing them at random does not work
// either. A matched pair of eight minute runs, same leash and same test for a keep: random
// candidates judged 147 boards and kept **none**, and climbing kept **26**, one in seven, the best
// of them measuring 12.54 against the 11.48 the shipped ladder tops out at.
//
// So each number is a *starting point*, and the search walks uphill from it: recolour one cell to a
// colour already beside it, judge, keep the change if it did not measure easier, and start again
// somewhere else after --steps without an improvement. Two things keep the climb honest, both of
// them learned the hard way from a version that recoloured a whole region at a time and managed 35
// judgements in eight minutes:
//
//   - one cell at a time, and never so as to leave a colour with a single dot or grow a
//     single-colour region past REGION_CAP. Difficulty counts the positions searched, and a big
//     blob of one colour has more of those than anything - so left alone, the climb walks straight
//     into boards that cannot be judged at all.
//   - a board that could not be judged inside the leash scores nothing, rather than scoring
//     whatever the unfinished walk came to. Same reason.
//
// Work is handed out by the parent, a climb at a time, because only the parent knows what each
// silhouette has yielded: it gives the next climb to whichever shape has produced least, then to
// whichever has been tried least. Left to themselves the workers spend the night on the smallest
// silhouette there is - a board costs about 1.5x more to judge per extra dot, so the cheapest shape
// gets through a hundred climbs for another's one. Where each shape has got to is written to
// state.json beside the finds, so running it again with the same --out carries on rather than
// re-walking ground already covered.
//
// Still deterministic: a starting point and the whole climb from it are a pure function of the
// number, so no two workers do the same work, `--from` carries on where the last run stopped, and
// `--show N` reproduces a starting point. A climb returns neighbours of itself, so a find is only
// kept if it differs from every find already kept by --apart cells.
//
// A word on size, since it decides what a run can do. Boards of 18 to 26 dots are judged in
// tenths of a second to a few seconds, so thousands an hour go past and they reach about 12 on the
// difficulty scale. Boards of 30 dots and up reach 13 and beyond, and take *minutes* each: they are
// worth a run of their own with --shape, --maxdots and a --seconds in the hundreds, not a share of
// a mixed one.
//
// DIR fills as it goes, a file per find named for how hard it measured so `ls` shows the best
// last, plus a summary.txt rewritten on every find. Both are safe to read while it runs. Nothing
// here ships: what ships is a layout pasted into src/modes/levels.js, where the level test
// recomputes its par and its floor.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { isMainThread, Worker, workerData, parentPort } from "node:worker_threads"
import { fileURLToPath } from "node:url"

import { analyse, greedily } from "../src/analysis.js"
import { loadCache } from "./verify-levels.mjs"
import { solve, parse, boardId } from "../src/solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"
import { PUZZLE } from "../src/modes/puzzle.js"
import { CONFIG } from "../src/config.js"

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

// The silhouettes. A hash is a dot and a stop is empty; what a column holds falls to the bottom of
// it, so these read as the shape the board will have. The big ones at the end are where the hard
// levels come from - more dots means more chains and more ways to go wrong several moves later -
// and they only became searchable once the analysis stopped walking the product of independent
// parts.
const SHAPES = {
  battlements: ["......", "......", "#..#..", "#..#..", "###.##", "######", "######"],
  staircase: ["......", ".....#", "....##", "...###", "..####", ".#####", "######"],
  wave: ["......", "......", "......", ".#.#.#", "##.#.#", "######", "######"],
  bullseye: ["......", "......", "......", ".####.", ".####.", ".####.", "######"],
  towers: ["......", "#....#", "#....#", "#....#", "######", "######", "######"],
  comb: ["......", "......", "#.#.#.", "#.#.#.", "######", "######", "######"],
  arch: ["......", "......", "##..##", "##..##", "######", "######", "######"],
  crown: ["......", "......", "#.##.#", "#.##.#", "######", "######", "######"],
  valley: ["......", "#....#", "##..##", "###.##", "######", "######", "######"],
  plateau: ["......", "......", "..##..", ".####.", "######", "######", "######"],
  chevron: ["......", "#....#", "##..##", "###.##", "######", "######", "######"],
  bars: ["......", "......", "......", "######", "######", "######", "######"],
  spire: ["......", "..##..", "..##..", "..##..", ".####.", "######", "######"],
  gate: ["......", "......", "#.##.#", "#.##.#", "#.##.#", "######", "######"],
  keep: ["......", "#.##.#", "#.##.#", "######", "######", "######", "######"],
  citadel: ["......", "##..##", "##..##", "######", "######", "######", "######"],
  ziggurat: ["......", "..##..", ".####.", ".####.", "######", "######", "######"],
  cliff: ["......", "###...", "###...", "####..", "#####.", "######", "######"],
  well: ["......", "##..##", "##..##", "##..##", "##..##", "######", "######"],
  mesa: ["......", "......", "######", "######", "######", "######", "######"],
  // Reaching the top of the field, which nothing above does. A full column is seven dots of a
  // colour or two stacked in one place, so a chain can run the height of the board and a pop near
  // the floor drops a great deal onto whatever is left - a different thing to go wrong than
  // anything a board with headroom can do.
  chimney: ["..##..", "..##..", "..##..", "..##..", "..##..", "######", "######"],
  mast: ["#.....", "#.....", "#.....", "#.....", "######", "######", "######"],
  steeple: ["..##..", "..##..", "..##..", ".####.", ".####.", "######", "######"],
  pylon: ["#....#", "#....#", "#....#", "#.##.#", "#.##.#", "######", "######"],
  palisade: ["#.#.#.", "#.#.#.", "#.#.#.", "#.#.#.", "######", "######", "######"],
  cathedral: [".#..#.", ".#..#.", ".####.", "######", "######", "######", "######"],
}

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

const OPTIONS = {
  out: arg("out", null),
  min: Number(arg("min", 11.5)),
  seconds: Number(arg("seconds", 45)),
  tries: Number(arg("tries", 0)),
  workers: Number(arg("workers", Math.max(1, Math.floor(os.cpus().length / 2)))),
  duty: Number(arg("duty", 100)),
  minutes: Number(arg("minutes", 0)),
  perShape: Number(arg("per-shape", 4)),
  shape: arg("shape", null),
  from: Number(arg("from", 0)),
  maxDots: Number(arg("maxdots", 26)),
  steps: Number(arg("steps", 20)),
  apart: Number(arg("apart", 4)),
}

// The biggest run of one colour a climb may make. Every connected subset of a region is a distinct
// move, so a blob past about this costs more to judge than the whole rest of the board, and the
// difficulty score rewards exactly that - so without a cap the climb goes nowhere else.
const REGION_CAP = 10

// Keeps the climb's stream of numbers clear of the one the colouring drew from, since both are
// seeded off the same starting number. Any value does; this one is arbitrary.
const CLIMB_SEED = 0x5f3a91

// ---- one candidate, from its number ----------------------------------------
// xorshift32, seeded from the candidate's number: enough to shuffle colours with, and it makes
// each candidate a pure function of that number.
function makeRandom(seed) {
  let state = seed | 0 || 1
  // Stirred, so consecutive numbers do not give near-identical boards.
  for (let i = 0; i < 8; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
  }
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 100000) / 100000
  }
}

// Fill a silhouette with colour by growing regions rather than by scattering dots.
//
// Scattering was the first attempt and one in twenty came out clearable: a colour whose dots are
// spread over the board strands almost every time. Growing a blob of two to six cells and colouring
// it whole is both far likelier to be playable and closer to what a person would draw, since it
// comes out as areas of colour rather than confetti. Regions of the same colour may touch, which is
// where the long chains and the choices come from.
//
// Returns null for a colouring that has a colour with one dot in it, which is a board that is dead
// before it starts and not worth judging.
function colourIn(shape, colours, random) {
  const cells = []
  const index = new Map()
  for (const [row, line] of shape.entries()) {
    for (let col = 0; col < PUZZLE_COLS; col++) {
      if (line[col] === "#") {
        index.set(`${col},${row}`, cells.length)
        cells.push({ col, row })
      }
    }
  }
  const colour = new Array(cells.length).fill(0)
  const neighbours = cells.map(({ col, row }) =>
    [
      [col - 1, row],
      [col + 1, row],
      [col, row - 1],
      [col, row + 1],
    ]
      .map(([c, r]) => index.get(`${c},${r}`))
      .filter((at) => at !== undefined),
  )
  const shuffled = (list) => {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  let next = 1
  for (;;) {
    const free = colour.map((value, at) => (value === 0 ? at : -1)).filter((at) => at >= 0)
    if (free.length === 0) {
      break
    }
    const want = 2 + Math.floor(random() * 5)
    const start = free[Math.floor(random() * free.length)]
    const blob = [start]
    colour[start] = next
    while (blob.length < want) {
      const edge = shuffled(blob.flatMap((at) => neighbours[at])).find((at) => colour[at] === 0)
      if (edge === undefined) {
        break
      }
      colour[edge] = next
      blob.push(edge)
    }
    // A region of one can never be matched on its own, so it joins whatever it is beside.
    if (blob.length < 2) {
      const beside = neighbours[start].find((at) => colour[at] !== 0 && at !== start)
      colour[start] = beside === undefined ? next : colour[beside]
    }
    next = (next % colours) + 1
  }

  const used = new Map()
  for (const value of colour) {
    used.set(value, (used.get(value) || 0) + 1)
  }
  if ([...used.values()].some((count) => count < 2)) {
    return null
  }

  const grid = shape.map((line) => line.split("").map((char) => (char === "#" ? "?" : ".")))
  for (const [at, cell] of cells.entries()) {
    grid[cell.row][cell.col] = String(colour[at])
  }
  return grid.map((line) => line.join(""))
}

// The candidate with this number: which silhouette, and how its colours fall.
function candidate(number, only) {
  const names = only ? [only] : Object.keys(SHAPES)
  const random = makeRandom(number + 1)
  const shape = names[Math.floor(random() * names.length)]
  const layout = colourIn(SHAPES[shape], 3 + Math.floor(random() * 3), random)
  return layout && { shape, layout }
}

// ---- one step uphill --------------------------------------------------------
// Where the dots are, and where they are next to each other, which both the mutation and the
// region measure need and neither the silhouette changes.
function dotsOf(layout) {
  const cells = []
  for (const [row, line] of layout.entries()) {
    for (let col = 0; col < PUZZLE_COLS; col++) {
      if (line[col] !== ".") {
        cells.push({ col, row })
      }
    }
  }
  return cells
}

// The largest run of one colour, which is what a judgement costs and so what has to be held down.
function biggestRun(layout) {
  const seen = new Set()
  let biggest = 0
  for (const { col, row } of dotsOf(layout)) {
    if (seen.has(`${col},${row}`)) {
      continue
    }
    const colour = layout[row][col]
    const stack = [[col, row]]
    seen.add(`${col},${row}`)
    let size = 0
    while (stack.length > 0) {
      const [atCol, atRow] = stack.pop()
      size++
      for (const [nextCol, nextRow] of [
        [atCol - 1, atRow],
        [atCol + 1, atRow],
        [atCol, atRow - 1],
        [atCol, atRow + 1],
      ]) {
        if (nextCol < 0 || nextRow < 0 || nextCol >= PUZZLE_COLS || nextRow >= PUZZLE_ROWS) {
          continue
        }
        if (layout[nextRow][nextCol] === colour && !seen.has(`${nextCol},${nextRow}`)) {
          seen.add(`${nextCol},${nextRow}`)
          stack.push([nextCol, nextRow])
        }
      }
    }
    biggest = Math.max(biggest, size)
  }
  return biggest
}

// Recolour one dot to a colour already beside it. One dot because a whole region at a time merges
// regions and runs the cost of a judgement away; a neighbour's colour because that keeps the board
// reading as areas rather than confetti, which is the same prior colourIn is built on.
//
// Returns null for a step not worth taking: nothing of another colour beside it, a colour left
// with a single dot, or a run grown past REGION_CAP.
function step(layout, random) {
  const cells = dotsOf(layout)
  const { col, row } = cells[Math.floor(random() * cells.length)]
  const beside = [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ]
    .filter(([c, r]) => c >= 0 && r >= 0 && c < PUZZLE_COLS && r < PUZZLE_ROWS)
    .map(([c, r]) => layout[r][c])
    .filter((colour) => colour !== "." && colour !== layout[row][col])
  if (beside.length === 0) {
    return null
  }
  const lines = layout.map((line) => [...line])
  lines[row][col] = beside[Math.floor(random() * beside.length)]
  const next = lines.map((line) => line.join(""))

  const used = new Map()
  for (const char of next.join("")) {
    if (char !== ".") {
      used.set(char, (used.get(char) || 0) + 1)
    }
  }
  if ([...used.values()].some((count) => count < 2)) {
    return null
  }
  return biggestRun(next) > REGION_CAP ? null : next
}

// How many cells two boards of the same silhouette differ in. A climb returns neighbours of
// itself, so this is what stops a run's finds all being the same board.
function apart(one, other) {
  let count = 0
  for (const [row, line] of one.entries()) {
    for (let col = 0; col < PUZZLE_COLS; col++) {
      if (line[col] !== other[row][col]) {
        count++
      }
    }
  }
  return count
}

// The boards already in the ladder, by identity. A climb that wanders onto one of them would spend
// its whole leash re-proving a board that has been proved, and then report it as a find - so it is
// skipped, which is the other half of what the verified file is for.
const SHIPPED = new Set(Object.keys(loadCache().boards))

// What a candidate has to be to be worth keeping. Difficulty is the gate; the rest is what the
// shipped levels at the hard end all have, and what makes one worth playing.
function wanted(found, min) {
  return (
    found.clearable === true &&
    found.exact &&
    // Everything below par comes from the whole-board walk, and a walk that stopped early reads
    // as harder than it is: the positions it never reached all count as traps. Without this a
    // run fills up with boards whose difficulty was never measured.
    found.statsExact &&
    found.difficulty >= min &&
    found.parPaths === 1 &&
    found.moves >= 4 &&
    (!found.greedy.clears || found.greedy.score < found.par)
  )
}

// ---- one worker's share ----------------------------------------------------
function hunt({ min, seconds, maxDots, steps, out, duty, until }) {
  // Whether to stop, checked between boards: a climb is up to `steps` boards and a board can take
  // `seconds`, so a check per climb could be minutes away from noticing. The file is only looked at
  // once a second, since asking the filesystem between boards that take a tenth of one is silly.
  const stopFile = path.join(out, "stop")
  let looked = 0
  let asked = false
  const stopping = () => {
    if (asked) {
      return true
    }
    if (until && Date.now() > until) {
      asked = true
      return true
    }
    if (Date.now() - looked > 1000) {
      looked = Date.now()
      asked = fs.existsSync(stopFile)
    }
    return asked
  }

  let started = 0
  let judged = 0
  let tooBig = 0
  let told = Date.now()

  // Judge one board and report it if it is worth keeping. What comes back is what the climb steers
  // by: the difficulty, or nothing at all for a board the cheap tests threw out or the walk could
  // not finish. A board that ran out of leash scores nothing rather than scoring what the
  // unfinished walk came to, since an unfinished walk reads as harder than the board is and the
  // climb would head straight for more of them.
  const judge = (layout, shapeName, from, taken) => {
    // Already a level: proved, shipped, and not a find. Cheapest test there is, so it goes first.
    if (SHIPPED.has(boardId(parse(layout, PUZZLE_COLS, PUZZLE_ROWS)))) {
      return null
    }
    if (!solve(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, 40000).solved) {
      return null
    }
    const greedy = greedily(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING)
    if (greedy.clears && greedy.moves <= 3) {
      return null
    }
    judged++
    const found = analyse(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
      seconds,
      budget: 40000000,
    })
    if (!found.statsExact) {
      tooBig++
      return null
    }
    if (wanted(found, min)) {
      parentPort.postMessage({
        kind: "found",
        candidate: {
          shape: shapeName,
          number: from,
          steps: taken,
          layout,
          par: found.par,
          floor: found.floor,
          difficulty: Number(found.difficulty.toFixed(2)),
          band: found.band,
          paths: found.parPaths,
          moves: found.moves,
          silent: `${found.firstSilent}/${found.firstMoves}`,
          greedy: found.greedy.clears ? found.greedy.score : "strands",
          dots: layout.join("").replace(/\./g, "").length,
          states: found.states,
          decomposed: found.decomposed,
        },
      })
    }
    return found.difficulty
  }

  // One climb, from the starting point the parent handed out. Returns whether it wants another.
  const climb = ({ shape, number }) => {
    // When this climb began, so the rest between climbs can be as long as the climb was.
    const climbStarted = Date.now()
    const made = candidate(number, shape)
    if (!made) {
      return true
    }
    // Too big to finish judging is as useless as unclearable, and costs the whole leash to find
    // out. Around thirty dots takes minutes to value exactly, so a mixed run skips them by
    // default; raise maxdots along with seconds to go looking there on purpose.
    if (made.layout.join("").replace(/\./g, "").length > maxDots) {
      return true
    }
    started++

    // The climb, seeded from the same number the starting point is, so the whole walk is a pure
    // function of it and a run can be stopped and resumed. Offset because the colouring draws
    // from a stream seeded the same way, and the two should not be walking in step.
    const random = makeRandom(number + 1 + CLIMB_SEED)
    let layout = made.layout
    let score = judge(layout, made.shape, number, 0)
    if (score == null) {
      return true
    }
    for (let stale = 0, taken = 0; stale < steps && !stopping();) {
      const next = step(layout, random)
      if (next === null) {
        stale++
        continue
      }
      const measured = judge(next, made.shape, number, taken + 1)
      if (measured == null || measured < score) {
        stale++
        continue
      }
      // Sideways counts as stale, so a plateau is left rather than wandered around: the whole
      // point of a restart is that somewhere else is likelier than more of here.
      stale = measured > score ? 0 : stale + 1
      score = measured
      layout = next
      taken++
    }

    if (Date.now() - told > 10000) {
      parentPort.postMessage({ kind: "progress", started, judged, tooBig })
      started = 0
      judged = 0
      tooBig = 0
      told = Date.now()
    }
    if (stopping()) {
      return false
    }
    rest(Date.now() - climbStarted, duty)
    return true
  }

  // Ask, climb, ask again. The parent decides what to hand out, so it can steer towards the shapes
  // that have yielded least - which it is the only one in a position to know.
  parentPort.on("message", (job) => {
    if (job.kind === "stop" || !climb(job)) {
      parentPort.postMessage({ kind: "done", started, judged, tooBig })
      process.exit(0)
    }
    parentPort.postMessage({ kind: "want" })
  })
  parentPort.postMessage({ kind: "want" })
}

// Rest as long as the last board took to judge, scaled by the duty cycle, so a long run can be told
// to leave the machine some air. Half duty is half the heat and half the boards, which on a hot day
// is the trade worth having. Synchronous on purpose: this is a worker whose whole job is one board
// after another, and there is nothing else here for an await to let through.
function rest(worked, duty) {
  if (duty >= 100 || worked <= 0) {
    return
  }
  const idle = Math.round(worked * (100 / duty - 1))
  if (idle > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, idle)
  }
}

// ---- the run ---------------------------------------------------------------
function main() {
  // Any starting point by number, to see where a find set off from and to check that the same
  // number really does give the same board. A find records the layout it ended on, so nothing has
  // to be replayed to get it back - this is for the other end of the climb.
  const show = arg("show", null)
  if (show !== null) {
    const made = candidate(Number(show), OPTIONS.shape)
    if (!made) {
      console.log(`starting point ${show} has a colour with one dot in it, so it is skipped`)
      return
    }
    console.log(`starting point ${show}: ${made.shape}`)
    for (const line of made.layout) {
      console.log(`      "${line}",`)
    }
    return
  }
  if (!OPTIONS.out) {
    console.error("--out DIR is where finds are written. See the header for the rest.")
    process.exit(1)
  }
  // "all" is the default said out loud, which is what a broad overnight run wants to be able to say.
  if (OPTIONS.shape === "all") {
    OPTIONS.shape = null
  }
  if (OPTIONS.shape && !SHAPES[OPTIONS.shape]) {
    console.error(`--shape must be "all" or one of: ${Object.keys(SHAPES).join(", ")}`)
    process.exit(1)
  }
  // Which silhouettes this run is over: one, or all of them.
  const shapeNames = OPTIONS.shape ? [OPTIONS.shape] : Object.keys(SHAPES)
  const out = path.resolve(OPTIONS.out)
  fs.mkdirSync(out, { recursive: true })
  // Left over from a previous run, this would stop the new one before it started.
  fs.rmSync(path.join(out, "stop"), { force: true })

  const found = []
  let starts = 0
  let judged = 0
  let tooBig = 0
  let alike = 0
  // Finds that were kept and then let go: bettered by their own climb, or over their shape's share.
  let dropped = 0
  let handed = 0
  const started = Date.now()

  const write = () => {
    found.sort((a, b) => b.difficulty - a.difficulty)
    const lines = found.map(
      (c) =>
        `${c.difficulty.toFixed(2).padStart(6)}  band ${c.band}  ${c.shape.padEnd(12)}` +
        `par ${String(c.par).padStart(6)}  floor ${String(c.floor).padStart(5)}  ` +
        `paths ${String(c.paths).padStart(2)}  chains ${c.moves}  ` +
        `silent ${c.silent.padStart(7)}  greedy ${String(c.greedy).padEnd(8)}  ` +
        `dots ${String(c.dots).padStart(2)}  ${fileFor(c)}`,
    )
    fs.writeFileSync(
      path.join(out, "summary.txt"),
      `Run it again with the same --out to carry on: state.json holds where each shape got to.\n` +
        `${found.length} kept, hardest first, measuring ${OPTIONS.min} or more.\n` +
        `${starts} started from, ${judged} judged, ${tooBig} too big to judge, ` +
        `${alike} dropped as too like a find already kept, ${dropped} let go again, ` +
        `${Math.round((Date.now() - started) / 1000)}s so far.\n\n${lines.join("\n")}\n`,
    )
  }
  const fileFor = (c) => `${c.difficulty.toFixed(2)}-${c.shape}-${c.number}-${c.steps}.json`

  // Written the moment it is found: a run of hours should not be lost to a closed terminal, and
  // looking at the directory while it runs should always work.
  const drop = (which) => {
    found.splice(found.indexOf(which), 1)
    fs.rmSync(path.join(out, fileFor(which)), { force: true })
    dropped++
  }

  const keep = (found_) => {
    // One find per climb, and the best one.
    //
    // A climb reports every step that clears the bar, and each step is the last board with one cell
    // recoloured - so a productive climb leaves a trail of its own worse ancestors. Left alone that
    // fills a directory: a cheap silhouette gets through many more climbs an hour, since a board
    // costs about 1.5x more to judge per extra dot, and each of those climbs leaves a trail.
    const earlier = found.find(
      (other) => other.shape === found_.shape && other.number === found_.number,
    )
    if (earlier) {
      if (earlier.difficulty >= found_.difficulty) {
        alike++
        return false
      }
      drop(earlier)
    }
    // And nothing that is another find with a few dots moved, whatever climb it came from.
    const like = found.some(
      (other) => other.shape === found_.shape && apart(other.layout, found_.layout) < OPTIONS.apart,
    )
    if (like) {
      alike++
      return false
    }
    found.push(found_)
    // No silhouette may take over: the weakest of a shape goes once it has more than its share, so
    // a long run comes back with a spread of boards rather than a hundred of whichever was cheapest.
    const sameShape = found
      .filter((other) => other.shape === found_.shape)
      .sort((a, b) => b.difficulty - a.difficulty)
    if (sameShape.length > OPTIONS.perShape) {
      const weakest = sameShape[sameShape.length - 1]
      if (weakest === found_) {
        drop(found_)
        return false
      }
      drop(weakest)
    }
    // Two spaces and a closing newline, so a directory of finds inside the repo does not fail
    // the format check.
    fs.writeFileSync(path.join(out, fileFor(found_)), `${JSON.stringify(found_, null, 2)}\n`)
    write()
    console.log(
      `kept ${found_.difficulty.toFixed(2)} ${found_.shape} par ${found_.par} ` +
        `floor ${found_.floor} chains ${found_.moves} silent ${found_.silent} ` +
        `greedy ${found_.greedy} dots ${found_.dots} ` +
        `(from ${found_.number} in ${found_.steps} steps, ${found.length} so far)`,
    )
    return true
  }

  // Where each shape has got to, and what it has yielded. Written down beside the finds, so a run
  // stopped overnight carries on from where each shape was rather than from one number for all of
  // them - which was the old shape of this, and meant resuming re-walked whatever the last run had
  // already tried on every other silhouette.
  const statePath = path.join(out, "state.json")
  const plan = {}
  const saved = (() => {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf8")).shapes ?? {}
    } catch {
      return {}
    }
  })()
  for (const name of shapeNames) {
    const from = OPTIONS.from > 0 ? OPTIONS.from : (saved[name]?.next ?? 0)
    plan[name] = { next: from, climbs: saved[name]?.climbs ?? 0, finds: saved[name]?.finds ?? 0 }
  }
  const saveState = () => {
    fs.writeFileSync(statePath, `${JSON.stringify({ shapes: plan }, null, 1)}\n`)
  }

  // Which shape to hand out next: the one that has yielded least, then the one tried least, with a
  // nudge of randomness so several workers asking at once do not all pile onto the same one. A
  // broad run therefore spreads itself over the silhouettes instead of following whichever is
  // cheapest to judge - a board costs about 1.5x more per extra dot, so left to itself the search
  // spends the night on the smallest shape there is.
  const nextJob = () => {
    const name = [...shapeNames].sort(
      (a, b) =>
        plan[a].finds - plan[b].finds || plan[a].climbs - plan[b].climbs || Math.random() - 0.5,
    )[0]
    const number = plan[name].next++
    plan[name].climbs++
    return { shape: name, number }
  }

  const here = fileURLToPath(import.meta.url)
  let running = 0
  for (let index = 0; index < OPTIONS.workers; index++) {
    const worker = new Worker(here, {
      workerData: {
        min: OPTIONS.min,
        seconds: OPTIONS.seconds,
        maxDots: OPTIONS.maxDots,
        steps: OPTIONS.steps,
        out,
        duty: OPTIONS.duty,
        until: OPTIONS.minutes > 0 ? Date.now() + OPTIONS.minutes * 60000 : 0,
      },
    })
    running++
    worker.on("message", (message) => {
      if (message.kind === "want") {
        // Out of starting points is the only reason to stop handing them out.
        if (OPTIONS.tries > 0 && handed >= OPTIONS.tries) {
          worker.postMessage({ kind: "stop" })
          return
        }
        handed++
        worker.postMessage(nextJob())
        return
      }
      if (message.kind === "found") {
        keep(message.candidate)
        // Counted from what is actually being kept rather than tallied as it goes. A tally has to
        // be right at both ends - a find kept and then let go, or one dropped the moment it
        // arrives because it was the weakest of its shape - and it was not.
        const shape = message.candidate.shape
        plan[shape].finds = found.filter((other) => other.shape === shape).length
        saveState()
        return
      }
      starts += message.started
      judged += message.judged
      tooBig += message.tooBig
      if (message.kind === "progress") {
        const minutes = (Date.now() - started) / 60000
        console.log(
          `${starts} started from, ${judged} judged, ${tooBig} too big, ${found.length} kept ` +
            `(${(judged / minutes).toFixed(0)} judged/min, ${minutes.toFixed(1)} min in)`,
        )
        write()
        saveState()
      }
    })
    worker.on("error", (error) => console.error("worker:", error.message))
    worker.on("exit", () => {
      running--
      if (running === 0) {
        write()
        saveState()
        const spread = shapeNames
          .filter((name) => plan[name].climbs > 0)
          .sort((a, b) => plan[b].finds - plan[a].finds)
          .map((name) => `${name} ${plan[name].finds}/${plan[name].climbs}`)
          .join(", ")
        console.log(`\n${found.length} kept in ${out}. Finds per climb: ${spread}.`)
        console.log("Run it again with the same --out to carry on where each shape got to.")
      }
    })
  }

  // Ctrl-C is a request to stop, not a reason to lose the run: it drops the same stop file the
  // workers watch for, so they finish the board in hand and exit, and the summary and the resume
  // point are written the way they are on any other ending. A second one gives up waiting.
  let stopping = false
  process.on("SIGINT", () => {
    if (stopping) {
      console.log("\nstopping now.")
      process.exit(130)
    }
    stopping = true
    fs.writeFileSync(path.join(out, "stop"), `asked to stop at ${new Date().toISOString()}\n`)
    console.log(
      "\nfinishing the boards in hand, then stopping. Ctrl-C again to stop without waiting.",
    )
  })

  console.log(
    `${OPTIONS.workers} workers, keeping anything measuring ${OPTIONS.min} or harder, ` +
      `${OPTIONS.seconds}s a board and ${OPTIONS.steps} steps without an improvement, ` +
      `climbing from ${OPTIONS.from}` +
      `${OPTIONS.tries === 0 ? ", until stopped." : `, ${OPTIONS.tries} starting points.`}`,
  )
  console.log(`finds land in ${out} as they happen; summary.txt there lists them.`)
}

if (isMainThread) {
  main()
} else {
  hunt(workerData)
}
