// Put a hunt's finds on one page, so a ladder can be picked by eye.
//
// A run of any length turns out hundreds of boards, and hundreds of PNGs in a directory is not
// something anyone can look at: the whole point of a silhouette is that it is judged at a glance,
// against its neighbours. So this writes an index beside them - every board at thumbnail size,
// grouped by the directory it came from, with what is known about it under it.
//
// Draw the boards first; this only lays out what render-boards.mjs has already drawn.
//
//   node tools/render-boards.mjs ../dots-puzzles/chain3/to-9
//   node tools/index-boards.mjs ../dots-puzzles/chain3
//
// The page is written to index.html in the directory it is pointed at, and refers to the pictures
// where they already are rather than copying them.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parse, unpack, EMPTY } from "../src/solver.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const where = process.argv[2]
if (!where) {
  console.error("usage: node tools/index-boards.mjs <directory of hunts>")
  process.exit(1)
}
const from = path.resolve(where)

// Every find, with the picture drawn for it. A hunt directory holds the finds; a tree of them
// holds one per band, which is how a sweep leaves them.
function findsIn(directory) {
  const boards = path.join(directory, "boards")
  if (!fs.existsSync(boards)) {
    return []
  }
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json") && name !== "state.json")
    .map((name) => {
      const picture = path.join(boards, name.replace(/\.json$/, ".png"))
      if (!fs.existsSync(picture)) {
        return null
      }
      return { ...JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")), picture }
    })
    .filter(Boolean)
    .sort((a, b) => b.difficulty - a.difficulty)
}

// The same board wearing different paint, by the identity test/levels.test.js holds the shipped
// ladders to: fallen, mirrored, and colours renamed in the order they are first met. A sweep finds
// the same board over and over - the climb is a pure function of its starting point, so every band
// whose range spans a board walks to it again - and a page that shows one board five times is a
// page nobody can pick from.
const fallen = (layout) => {
  const grid = unpack(parse(layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
  return Array.from({ length: PUZZLE_ROWS }, (_, row) =>
    Array.from({ length: PUZZLE_COLS }, (_, col) => {
      const cell = grid[col + row * PUZZLE_COLS]
      return cell === EMPTY ? "." : String(cell)
    }).join(""),
  )
}
const renamed = (rows) => {
  const seen = new Map()
  return rows
    .map((row) =>
      [...row]
        .map((cell) =>
          cell === "."
            ? "."
            : (seen.has(cell) ? seen : seen.set(cell, String(seen.size))).get(cell),
        )
        .join(""),
    )
    .join("|")
}
const identity = (layout) => {
  const rows = fallen(layout)
  const mirrored = rows.map((row) => [...row].reverse().join(""))
  return [renamed(rows), renamed(mirrored)].sort()[0]
}

const hunts = []
const walk = (directory) => {
  const found = findsIn(directory)
  if (found.length > 0) {
    hunts.push({ name: path.relative(from, directory) || path.basename(directory), found })
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "boards") {
      walk(path.join(directory, entry.name))
    }
  }
}
walk(from)
if (hunts.length === 0) {
  console.error(`no drawn finds under ${path.relative(ROOT, from)}. Run render-boards.mjs first.`)
  process.exit(1)
}
// By what each hunt was after, which for a sweep is the order the ladder climbs in.
hunts.sort((a, b) => a.found.at(-1).difficulty - b.found.at(-1).difficulty)

// A board is shown under the first hunt that found it, which after that sort is the gentlest band
// it fell in - the one whose ceiling it really belongs to.
const kept = new Set()
let folded = 0
for (const hunt of hunts) {
  hunt.found = hunt.found.filter((find) => {
    const id = identity(find.layout)
    if (kept.has(id)) {
      folded++
      return false
    }
    kept.add(id)
    return true
  })
}
// A band whose every find turned up in a gentler one has nothing of its own to show.
const showing = hunts.filter((hunt) => hunt.found.length > 0)

const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  )

// What is worth knowing at a glance, under each board. Everything else is in the JSON beside it.
const caption = (find) =>
  [
    `<b>${find.difficulty}</b> ${escape(find.shape)}`,
    `par ${find.par} floor ${find.floor}`,
    `${find.moves} chains, ${find.paths} best`,
    `silent ${escape(find.silent)}`,
    `greed ${escape(find.greedy)}`,
  ].join("<br>")

const total = showing.reduce((count, hunt) => count + hunt.found.length, 0)
const page = `<!doctype html>
<meta charset="utf-8">
<title>Boards found</title>
<style>
  :root { color-scheme: dark; }
  body { background: #0c0f16; color: #c8cdd8; font: 13px/1.45 ui-monospace, monospace; margin: 0 0 4rem; }
  h1 { font-size: 1.1rem; padding: 1rem 1.25rem 0; margin: 0; }
  h1 small { color: #6f7787; font-weight: normal; }
  h2 { position: sticky; top: 0; background: #0c0f16; margin: 0; padding: 1.25rem; font-size: 1rem; border-bottom: 1px solid #1d2230; }
  h2 small { color: #6f7787; font-weight: normal; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 1rem; padding: 1rem 1.25rem 2rem; }
  figure { margin: 0; }
  img { width: 100%; display: block; border-radius: 6px; background: #11151f; }
  figcaption { color: #8b93a4; padding-top: .4rem; font-size: 11px; }
  b { color: #e6eaf2; }
</style>
<h1>Boards found <small>${total} distinct across ${showing.length} hunts, hardest first within each${folded > 0 ? `, ${folded} repeats folded away` : ""}</small></h1>
${showing
  .map(
    (hunt) => `<section>
<h2>${escape(hunt.name)} <small>${hunt.found.length} boards, ${hunt.found.at(-1).difficulty} to ${hunt.found[0].difficulty}</small></h2>
<div class="grid">
${hunt.found
  .map(
    (find) =>
      `<figure><img loading="lazy" src="${escape(path.relative(from, find.picture))}" alt="${escape(find.shape)} measuring ${find.difficulty}"><figcaption>${caption(find)}</figcaption></figure>`,
  )
  .join("\n")}
</div>
</section>`,
  )
  .join("\n")}
`

const file = path.join(from, "index.html")
fs.writeFileSync(file, page)
console.log(
  `${total} distinct boards across ${showing.length} hunts into ${path.relative(ROOT, file)}` +
    `${folded > 0 ? `, ${folded} mirrors and recolourings folded away` : ""}`,
)
