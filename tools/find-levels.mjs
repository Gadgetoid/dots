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
// | flag        | what it does                                                          |
// | ----------- | --------------------------------------------------------------------- |
// | --out DIR   | a directory; one file per find, written the moment it is found         |
// | --min N     | keep candidates measuring at least this hard (default 11.5)           |
// | --seconds N | how long one candidate may be judged for (default 45)                 |
// | --tries N   | stop after this many candidates (default 0, meaning never)             |
// | --workers N | how many at once (default one per core, less one)                     |
// | --shape S   | only this silhouette                                                  |
// | --from N    | start at this candidate number, to carry on where a run left off       |
// | --show N    | print candidate N and stop, to see or reproduce one                    |
//
// Every candidate is a pure function of its number, so a run repeats nothing, two workers never
// try the same board, and stopping and restarting from the number the last run reached carries on
// rather than starting again. It does not enumerate every colouring: even the smallest silhouette
// here has 3e10 of them and the biggest 2e20, which at the rate they can be judged is four years
// and twenty-five billion respectively. What it enumerates is a structured subset - colours grown
// as regions rather than scattered - because a colour whose dots are spread over the board strands
// almost every time: one in twenty of those is clearable against one in three of these.
//
// DIR fills as it goes, a file per candidate named for how hard it measured so `ls` shows the best
// last, plus a summary.txt rewritten on every find. Both are safe to read while it runs. Nothing
// here ships: what ships is a layout pasted into src/modes/levels.js, where the level test
// recomputes its par and its floor.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { isMainThread, Worker, workerData, parentPort } from "node:worker_threads"
import { fileURLToPath } from "node:url"

import { analyse, greedily } from "../src/analysis.js"
import { solve } from "../src/solver.js"
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
  workers: Number(arg("workers", Math.max(1, os.cpus().length - 1))),
  shape: arg("shape", null),
  from: Number(arg("from", 0)),
}

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

// What a candidate has to be to be worth keeping. Difficulty is the gate; the rest is what the
// shipped levels at the hard end all have, and what makes one worth playing.
function wanted(found, min) {
  return (
    found.clearable === true &&
    found.exact &&
    found.difficulty >= min &&
    found.parPaths === 1 &&
    found.moves >= 4 &&
    (!found.greedy.clears || found.greedy.score < found.par)
  )
}

// ---- one worker's share ----------------------------------------------------
function hunt({ first, stride, min, seconds, tries, shape }) {
  let tried = 0
  let clearable = 0
  let judged = 0
  let told = Date.now()
  let number = first

  for (let done = 0; tries === 0 || done < tries; done++, number += stride) {
    const made = candidate(number, shape)
    if (!made) {
      continue
    }
    tried++

    // Cheap rejections first, in the order of how cheap they are. Proving a board cannot be cleared
    // means exhausting its whole graph, the slowest thing here and the commonest outcome, so
    // finding one clearing order comes first. Then greed: at the hard end a level either strands
    // the board or leaves score on the table when played the obvious way, and one play says which.
    if (!solve(made.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, 40000).solved) {
      continue
    }
    clearable++
    const greedy = greedily(made.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING)
    if (greedy.clears && greedy.moves <= 3) {
      continue
    }

    judged++
    const found = analyse(made.layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
      seconds,
      budget: 40000000,
    })
    if (wanted(found, min)) {
      parentPort.postMessage({
        kind: "found",
        candidate: {
          shape: made.shape,
          number,
          layout: made.layout,
          par: found.par,
          floor: found.floor,
          difficulty: Number(found.difficulty.toFixed(2)),
          band: found.band,
          paths: found.parPaths,
          moves: found.moves,
          silent: `${found.firstSilent}/${found.firstMoves}`,
          greedy: found.greedy.clears ? found.greedy.score : "strands",
          dots: made.layout.join("").replace(/\./g, "").length,
          states: found.states,
          decomposed: found.decomposed,
        },
      })
    }
    if (Date.now() - told > 10000) {
      parentPort.postMessage({ kind: "progress", tried, clearable, judged, reached: number })
      tried = 0
      clearable = 0
      judged = 0
      told = Date.now()
    }
  }
  parentPort.postMessage({ kind: "done", tried, clearable, judged, reached: number })
}

// ---- the run ---------------------------------------------------------------
function main() {
  // Any candidate by number, to see what a find in the directory actually was and to check that
  // the same number really does give the same board.
  const show = arg("show", null)
  if (show !== null) {
    const made = candidate(Number(show), OPTIONS.shape)
    if (!made) {
      console.log(`candidate ${show} has a colour with one dot in it, so it is skipped`)
      return
    }
    console.log(`candidate ${show}: ${made.shape}`)
    for (const line of made.layout) {
      console.log(`      "${line}",`)
    }
    return
  }
  if (!OPTIONS.out) {
    console.error("--out DIR is where finds are written. See the header for the rest.")
    process.exit(1)
  }
  if (OPTIONS.shape && !SHAPES[OPTIONS.shape]) {
    console.error(`--shape must be one of: ${Object.keys(SHAPES).join(", ")}`)
    process.exit(1)
  }
  const out = path.resolve(OPTIONS.out)
  fs.mkdirSync(out, { recursive: true })

  const found = []
  let tried = 0
  let clearable = 0
  let judged = 0
  let reached = OPTIONS.from
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
      `${found.length} kept, hardest first, measuring ${OPTIONS.min} or more.\n` +
        `${tried} tried, ${clearable} clearable, ${judged} judged, ` +
        `${Math.round((Date.now() - started) / 1000)}s so far, reached candidate ${reached}.\n` +
        `Carry on with --from ${reached}.\n\n${lines.join("\n")}\n`,
    )
  }
  const fileFor = (c) => `${c.difficulty.toFixed(2)}-${c.shape}-${c.number}.json`

  // Written the moment it is found: a run of hours should not be lost to a closed terminal, and
  // looking at the directory while it runs should always work.
  const keep = (found_) => {
    found.push(found_)
    fs.writeFileSync(path.join(out, fileFor(found_)), JSON.stringify(found_, null, 1))
    write()
    console.log(
      `kept ${found_.difficulty.toFixed(2)} ${found_.shape} par ${found_.par} ` +
        `floor ${found_.floor} chains ${found_.moves} silent ${found_.silent} ` +
        `greedy ${found_.greedy} dots ${found_.dots} (${found.length} so far)`,
    )
  }

  const here = fileURLToPath(import.meta.url)
  let running = 0
  for (let index = 0; index < OPTIONS.workers; index++) {
    const worker = new Worker(here, {
      workerData: {
        // Interleaved by worker, so no two ever try the same candidate.
        first: OPTIONS.from + index,
        stride: OPTIONS.workers,
        min: OPTIONS.min,
        seconds: OPTIONS.seconds,
        tries: OPTIONS.tries === 0 ? 0 : Math.ceil(OPTIONS.tries / OPTIONS.workers),
        shape: OPTIONS.shape,
      },
    })
    running++
    worker.on("message", (message) => {
      if (message.kind === "found") {
        keep(message.candidate)
        return
      }
      tried += message.tried
      clearable += message.clearable
      judged += message.judged
      reached = Math.max(reached, message.reached)
      if (message.kind === "progress") {
        const minutes = (Date.now() - started) / 60000
        console.log(
          `${tried} tried, ${clearable} clearable, ${judged} judged, ${found.length} kept ` +
            `(${(tried / minutes).toFixed(0)}/min, ${minutes.toFixed(1)} min in, at ${reached})`,
        )
        write()
      }
    })
    worker.on("error", (error) => console.error("worker:", error.message))
    worker.on("exit", () => {
      running--
      if (running === 0) {
        write()
        console.log(`\n${found.length} kept in ${out}. Carry on with --from ${reached}.`)
      }
    })
  }

  console.log(
    `${OPTIONS.workers} workers, keeping anything measuring ${OPTIONS.min} or harder, ` +
      `${OPTIONS.seconds}s a candidate, from candidate ${OPTIONS.from}` +
      `${OPTIONS.tries === 0 ? ", until stopped." : `, ${OPTIONS.tries} of them.`}`,
  )
  console.log(`finds land in ${out} as they happen; summary.txt there lists them.`)
}

if (isMainThread) {
  main()
} else {
  hunt(workerData)
}
