// Search for puzzle levels worth shipping.
//
// The shapes here are drawn by hand, because a silhouette is the part a player looks at and
// no search knows what looks good. The colours are what gets searched, because the qualities
// a level needs are not ones you can see in a layout: whether it can be cleared at all,
// whether how you play it changes what it pays, whether the obvious play is wrong, and
// whether the traps in it are the kind anyone would actually fall into.
//
// That last one is why this exists rather than hand-authoring twenty levels. Every level in
// the original seven turns out to have no silent traps at all: every opening that loses is
// one that leaves a dot sitting on its own where a player can see it. Traps that do not
// announce themselves come out of the collapse, several moves deep, and hand-guessing which
// arrangement has them is hopeless. Analysing a few thousand is not.
//
//   node tools/find-levels.mjs --want spread --take 3
//   node tools/find-levels.mjs --want single --tries 4000 --out found.json
//
// `want` picks what a candidate is being judged for:
//
//   easy     clearable, nothing silent to fall into, a couple of chains
//   spread   many orders clear it and they pay very differently: something to aim at
//   single   exactly one order pays par, and the obvious play does not
//   cruel    one order pays par, the obvious play strands the board, and the traps are
//            silent - the top of the ladder
//
// Nothing here ships. What ships is the layouts it prints, pasted into src/modes/levels.js
// with their par, where the level test recomputes both.

import fs from "node:fs"
import { analyse } from "../src/analysis.js"
import { solve } from "../src/solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"
import { PUZZLE } from "../src/modes/puzzle.js"
import { CONFIG } from "../src/config.js"

const SCORING = {
  scoreChain: CONFIG.chainScore,
  multiplierAfter: (multiplier, length) =>
    length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1,
}

// The silhouettes. A hash is a dot and a stop is empty; what a column holds falls to the
// bottom of it, so these read as the shape the board will actually have.
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
  // The bigger shapes, for the hard end. Judging one of these was out of reach before the
  // search valued outcomes instead of chains; they carry more dots, so more chains, so more
  // ways to go wrong several moves later.
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

// Seeded, so a run can be repeated. xorshift32 is plenty for shuffling colours.
let seed = Number(arg("seed", 20260729)) | 0 || 1
function random() {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 100000) / 100000
}
const pick = (list) => list[Math.floor(random() * list.length)]

function shuffled(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Fill a silhouette with colour, by growing regions rather than by scattering dots.
//
// Scattering was the first attempt and one in twenty came out clearable: a colour with its
// dots spread over the board strands almost every time. Growing a blob of two to six cells
// and colouring it whole is both far more likely to be playable and closer to what a person
// would draw, since it comes out as areas of colour rather than confetti. Regions of the same
// colour are allowed to touch, which is where the long chains and the choices come from.
function colourIn(shape, colours) {
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

  let next = 1
  for (;;) {
    const free = colour.map((value, at) => (value === 0 ? at : -1)).filter((at) => at >= 0)
    if (free.length === 0) {
      break
    }
    const want = 2 + Math.floor(random() * 5)
    const start = pick(free)
    const blob = [start]
    colour[start] = next
    // Grow into whatever is next to what has been taken so far.
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

  // A colour that ended up with a single dot anywhere on the board is a level that is dead
  // before it starts, and not worth analysing.
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

// What each kind of level has to be. Everything is measured, so a candidate either is one of
// these or it is not.
const WANTS = {
  easy: (found) =>
    found.band <= 2 && found.moves >= 3 && found.firstSilent === 0 && found.par < 2000,
  spread: (found) =>
    found.band >= 2 &&
    found.band <= 3 &&
    found.parPaths > 1 &&
    found.floor * 4 < found.par &&
    found.moves >= 4,
  single: (found) =>
    found.band >= 3 && found.parPaths === 1 && found.moves >= 4 && found.greedy.score < found.par,
  cruel: (found) =>
    found.band >= 4 && found.parPaths === 1 && found.firstSilent > 0 && !found.greedy.clears,
  // Past the current top of the ladder, which is what a level added to the end has to be.
  crueller: (found) =>
    found.difficulty > 11.5 &&
    found.parPaths === 1 &&
    found.firstSilent > 0 &&
    !found.greedy.clears &&
    found.moves >= 5,
}

const tries = Number(arg("tries", 1500))
const take = Number(arg("take", 6))
const only = arg("shape", null)
const out = arg("out", null)
const shapeNames = only ? [only] : Object.keys(SHAPES)

// Every candidate is judged against every profile in one pass: analysing one is the expensive
// part by orders of magnitude, so running the search once per profile would be four times the
// work for the same answers.
const buckets = new Map(Object.keys(WANTS).map((name) => [name, []]))
let clearable = 0
let tried = 0

function report() {
  if (!out) {
    return
  }
  const summary = {}
  for (const [name, list] of buckets) {
    summary[name] = best(list, take).map((candidate) => ({
      shape: candidate.shape,
      layout: candidate.layout,
      par: candidate.par,
      floor: candidate.floor,
      paths: candidate.parPaths,
      band: candidate.band,
      difficulty: Number(candidate.difficulty.toFixed(2)),
      moves: candidate.moves,
      silent: `${candidate.firstSilent}/${candidate.firstMoves}`,
      greedy: candidate.greedy.clears ? candidate.greedy.score : "strands",
      dots: candidate.layout.join("").replace(/\./g, "").length,
    }))
  }
  fs.writeFileSync(out, JSON.stringify({ tried, clearable, ...summary }, null, 1))
}

// Best first by difficulty, and never two of the same silhouette: a set picked from this
// should not be four versions of the same picture.
function best(list, howMany) {
  const sorted = [...list].sort(
    (a, b) => b.difficulty - a.difficulty || b.par - b.floor - (a.par - a.floor),
  )
  const chosen = []
  const used = new Set()
  for (const candidate of sorted) {
    if (used.has(candidate.shape)) {
      continue
    }
    used.add(candidate.shape)
    chosen.push(candidate)
    if (chosen.length >= howMany) {
      break
    }
  }
  return chosen
}

for (let attempt = 0; attempt < tries; attempt++) {
  const shape = pick(shapeNames)
  const layout = colourIn(SHAPES[shape], 3 + Math.floor(random() * 3))
  if (!layout) {
    continue
  }
  tried++
  // Cheap reject first. Finding one clearing order is quick and it is what most candidates
  // fail; proving a board cannot be cleared means exhausting the whole graph, which is the
  // slowest thing here and would be spent on the candidates that deserve it least.
  if (!solve(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, 30000).solved) {
    continue
  }
  const found = analyse(layout, PUZZLE_COLS, PUZZLE_ROWS, PUZZLE.minChain, SCORING, {
    seconds: 4,
    budget: 400000,
  })
  // Three-valued now: only a definite yes is worth judging, and only an exact answer is worth
  // shipping, since the level test recomputes par and floor.
  if (found.clearable !== true || !found.exact) {
    continue
  }
  clearable++
  for (const [name, matches] of Object.entries(WANTS)) {
    if (matches(found)) {
      buckets.get(name).push({ shape, layout, ...found })
      console.log(
        `${name}: ${shape} band ${found.band} par ${found.par} floor ${found.floor} ` +
          `paths ${found.parPaths} moves ${found.moves} silent ${found.firstSilent}/${found.firstMoves} ` +
          `greedy ${found.greedy.clears ? found.greedy.score : "strands"}`,
      )
      report()
    }
  }
}

console.log(`\n${tried} tried, ${clearable} clearable`)
for (const [name, list] of buckets) {
  console.log(`  ${name}: ${list.length} found`)
}
report()
