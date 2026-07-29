// The level editor: draw a board, and be told what it is.
//
// Outside the game and not shipped with it, but built out of the same parts - the same
// renderer, the same palette, the same board layout, and the same analysis the level test
// runs - so a board drawn here looks exactly like the board that will be played and the
// numbers under it are the numbers that will be true.
//
// What it is for is the three questions authoring a level actually raises, none of which can
// be answered by looking: can this be cleared at all, what is the most it can pay, and is
// there anything in it worth playing. See src/analysis.js. The answers arrive from a worker a
// moment after each edit, and the panel says so while it waits.

import { WebGLRenderer } from "../glrenderer.js"
import { CONFIG, VIEW_W, VIEW_H, boardLayout, cellCentre, cellAt } from "../config.js"
import { THEMES } from "../palette.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"

const EMPTY = -1
const COLOURS = 5

const canvas = document.getElementById("board")
const renderer = WebGLRenderer.create(canvas)
if (!renderer) {
  document.getElementById("board").outerHTML = '<p class="warn">WebGL2 required</p>'
  throw new Error("WebGL2 unavailable")
}

const theme = THEMES.dark
const layout = boardLayout(PUZZLE_COLS, PUZZLE_ROWS)

// The board being drawn, as it is written: a cell holds a colour or nothing, and nothing here
// falls. What the level will look like once it does is what `collapsed` shows.
const cells = new Int8Array(PUZZLE_COLS * PUZZLE_ROWS).fill(EMPTY)
let brush = 0
let hover = null
let edit = 0
let latest = null
let waiting = false
let showFall = true

// ---- the board ------------------------------------------------------------
// Everything falls to the lowest free cell in its column, which is what the game does the
// moment a level is loaded. Shown by default: what a level *is* is the fallen board, and a
// shape drawn in mid air is a common way to be surprised by one.
function collapsed() {
  const out = new Int8Array(cells)
  for (let col = 0; col < PUZZLE_COLS; col++) {
    let free = PUZZLE_ROWS - 1
    for (let row = PUZZLE_ROWS - 1; row >= 0; row--) {
      const value = out[col + row * PUZZLE_COLS]
      if (value === EMPTY) {
        continue
      }
      out[col + row * PUZZLE_COLS] = EMPTY
      out[col + free * PUZZLE_COLS] = value
      free--
    }
  }
  return out
}

function asLayout(grid = cells) {
  const lines = []
  for (let row = 0; row < PUZZLE_ROWS; row++) {
    let line = ""
    for (let col = 0; col < PUZZLE_COLS; col++) {
      const value = grid[col + row * PUZZLE_COLS]
      line += value === EMPTY ? "." : String(value + 1)
    }
    lines.push(line)
  }
  return lines
}

function loadLayout(lines) {
  cells.fill(EMPTY)
  for (let row = 0; row < PUZZLE_ROWS; row++) {
    const line = lines[row] || ""
    for (let col = 0; col < PUZZLE_COLS; col++) {
      const char = line[col] ?? "."
      if (char !== "." && char !== "0") {
        cells[col + row * PUZZLE_COLS] = Math.min(Number(char) - 1, COLOURS - 1)
      }
    }
  }
  changed()
}

// ---- drawing --------------------------------------------------------------
function draw() {
  renderer.brightness = 1
  renderer.glowIntensity = CONFIG.BLOOM_INTENSITY * theme.bloom
  renderer.vignette = 0.4
  renderer.beginFrame(performance.now() / 1000)
  renderer.clearFrame(theme.background)

  const pad = layout.cell * 0.22
  renderer.panel(layout.x - pad, layout.y - pad, layout.width + pad * 2, layout.height + pad * 2, {
    fill: theme.well,
    radius: layout.cell * 0.5,
  })

  const grid = showFall ? collapsed() : cells
  for (let row = 0; row < PUZZLE_ROWS; row++) {
    for (let col = 0; col < PUZZLE_COLS; col++) {
      const at = cellCentre(layout, col, row)
      const colour = grid[col + row * PUZZLE_COLS]
      if (colour === EMPTY) {
        renderer.disc(at.x, at.y, layout.radius * 0.16, { color: theme.cell })
        continue
      }
      renderer.disc(at.x, at.y, layout.radius, {
        color: theme.dots[colour % theme.dots.length].base,
        sheen: 0.18,
      })
    }
  }

  // Where the brush is, and what it would put there.
  if (hover) {
    const at = cellCentre(layout, hover.col, hover.row)
    renderer.ring(at.x, at.y, layout.radius * 1.18, { color: theme.text.bright, width: 2 })
    if (brush > 0) {
      renderer.disc(at.x, at.y, layout.radius * 0.4, {
        color: theme.dots[(brush - 1) % theme.dots.length].bright,
        alpha: 0.7,
      })
    }
  }

  // The palette, under the board: the five colours the puzzle mode deals and an eraser.
  for (let i = 0; i <= COLOURS; i++) {
    const box = paletteBox(i)
    const chosen = brush === i
    renderer.panel(box.x, box.y, box.w, box.h, {
      fill: chosen ? theme.accent : theme.cell,
      alpha: chosen ? 1 : 0.9,
    })
    if (i === 0) {
      renderer.text("x", box.x + box.w / 2, box.y + box.h / 2, {
        color: chosen ? theme.panel : theme.text.dim,
        size: 22,
        align: "center",
        baseline: "middle",
        bold: true,
      })
    } else {
      renderer.disc(box.x + box.w / 2, box.y + box.h / 2, box.h * 0.3, {
        color: theme.dots[(i - 1) % theme.dots.length].base,
      })
    }
  }

  renderer.text(
    showFall ? "showing the board as it falls" : "showing the layout as written",
    VIEW_W / 2,
    VIEW_H - 26,
    { color: theme.text.faint, size: 17, align: "center" },
  )
  renderer.endFrame()
}

function paletteBox(index) {
  const width = 62
  const gap = 8
  const total = (COLOURS + 1) * width + COLOURS * gap
  return {
    x: (VIEW_W - total) / 2 + index * (width + gap),
    y: VIEW_H - 96,
    w: width,
    h: 46,
  }
}

// ---- input ----------------------------------------------------------------
function pointAt(event) {
  const bounds = canvas.getBoundingClientRect()
  const content = view.content
  return {
    x: ((event.clientX - bounds.left - content.x) / content.width) * VIEW_W,
    y: ((event.clientY - bounds.top - content.y) / content.height) * VIEW_H,
  }
}

// The letterboxing the game's view does, without the game's view: the editor has no HUD and
// no menus, so this is all of it that applies.
const view = {
  content: { x: 0, y: 0, width: VIEW_W, height: VIEW_H },
  resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (
      rect.width === this.sized?.width &&
      rect.height === this.sized?.height &&
      dpr === this.sized?.dpr
    ) {
      return
    }
    this.sized = { width: rect.width, height: rect.height, dpr }
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H)
    this.content = {
      x: (rect.width - VIEW_W * scale) / 2,
      y: (rect.height - VIEW_H * scale) / 2,
      width: VIEW_W * scale,
      height: VIEW_H * scale,
    }
    renderer.setContentRect(
      this.content.x,
      this.content.y,
      this.content.width,
      this.content.height,
      dpr,
    )
  },
}

let painting = false
// What this drag has already painted. A drag fires a move event for every pixel, and in the
// fallen view every paint adds another dot to the column - so without this, a press and a
// twitch fills the column to the top. One dot per column per drag: press again for another,
// and drag sideways to lay a row of them.
let painted = new Set()

function paint(point) {
  // The board is drawn fallen, so a cell pressed there is not the cell it is written in: the
  // press lands on the column, and the row is where the writing has room.
  const cell = cellAt(layout, point.x, point.y)
  if (!cell) {
    return false
  }
  const already = showFall ? `${cell.col}` : `${cell.col},${cell.row}`
  if (painted.has(already)) {
    return false
  }
  painted.add(already)
  if (showFall) {
    return paintColumn(cell.col)
  }
  const at = cell.col + cell.row * PUZZLE_COLS
  const value = brush === 0 ? EMPTY : brush - 1
  if (cells[at] === value) {
    return false
  }
  cells[at] = value
  changed()
  return true
}

// Painting a fallen board: adding puts a dot at the bottom of the column, erasing takes the
// top one off. Anything else would move dots the author did not press.
function paintColumn(col) {
  const column = []
  for (let row = 0; row < PUZZLE_ROWS; row++) {
    if (cells[col + row * PUZZLE_COLS] !== EMPTY) {
      column.push(row)
    }
  }
  if (brush === 0) {
    if (column.length === 0) {
      return false
    }
    cells[col + column[0] * PUZZLE_COLS] = EMPTY
    changed()
    return true
  }
  if (column.length >= PUZZLE_ROWS) {
    return false
  }
  const row = column.length === 0 ? PUZZLE_ROWS - 1 : column[0] - 1
  cells[col + row * PUZZLE_COLS] = brush - 1
  changed()
  return true
}

canvas.addEventListener("pointerdown", (event) => {
  const point = pointAt(event)
  for (let i = 0; i <= COLOURS; i++) {
    const box = paletteBox(i)
    if (
      point.x >= box.x &&
      point.y >= box.y &&
      point.x <= box.x + box.w &&
      point.y <= box.y + box.h
    ) {
      brush = i
      return
    }
  }
  painting = true
  painted = new Set()
  canvas.setPointerCapture(event.pointerId)
  paint(point)
})
canvas.addEventListener("pointermove", (event) => {
  const point = pointAt(event)
  hover = cellAt(layout, point.x, point.y)
  if (painting) {
    paint(point)
  }
})
canvas.addEventListener("pointerup", () => {
  painting = false
})
canvas.addEventListener("pointerleave", () => {
  hover = null
})

addEventListener("keydown", (event) => {
  if (event.target !== document.body && event.target !== canvas) {
    return
  }
  const digit = Number(event.key)
  if (event.key >= "0" && event.key <= String(COLOURS)) {
    brush = digit
    return
  }
  if (event.key === "f") {
    showFall = !showFall
  }
  if (event.key === "c") {
    cells.fill(EMPTY)
    changed()
  }
})

// ---- the panel ------------------------------------------------------------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
const out = {
  verdict: document.getElementById("verdict"),
  numbers: document.getElementById("numbers"),
  snippet: document.getElementById("snippet"),
  note: document.getElementById("note"),
}

let pending = null
function changed() {
  edit++
  waiting = true
  // Debounced: a drag across the board is a dozen edits and only the last one is worth
  // several seconds of thinking.
  clearTimeout(pending)
  pending = setTimeout(() => worker.postMessage({ layout: asLayout(), edit }), 220)
  render()
}

worker.onmessage = (event) => {
  if (event.data.edit !== edit) {
    return
  }
  latest = event.data
  waiting = false
  render()
}

const BANDS = ["-", "1 warm up", "2 gentle", "3 real", "4 hard", "5 cruel"]

function render() {
  const dots = [...cells].filter((value) => value !== EMPTY).length
  const found = latest && latest.found
  out.note.textContent = waiting ? "thinking..." : latest ? `judged in ${latest.took}ms` : ""
  out.note.className = waiting ? "note working" : "note"

  if (dots === 0) {
    out.verdict.textContent = "empty"
    out.verdict.className = "verdict"
    out.numbers.innerHTML = ""
    out.snippet.textContent = ""
    return
  }
  if (!found) {
    out.verdict.textContent = "..."
    out.verdict.className = "verdict"
    return
  }

  if (found.clearable === false) {
    // The one thing that makes a board not a level, and the only case where that can be said
    // outright: the whole graph was walked and nothing in it empties the board.
    out.verdict.textContent = "cannot be cleared"
    out.verdict.className = "verdict bad"
    out.numbers.innerHTML =
      row("dots", dots) + row("openings", found.firstMoves) + row("all of them strand it", "yes")
    out.snippet.textContent = ""
    return
  }
  if (found.clearable === null) {
    // Neither answer was reached. Which is nearly always one thing: a big region of one colour
    // has more chains through it than can be listed, let alone valued.
    out.verdict.textContent = "cannot be judged"
    out.verdict.className = "verdict bad"
    out.numbers.innerHTML =
      row("dots", dots) +
      row(
        "biggest one colour",
        found.biggestRegion,
        found.biggestRegion > 12
          ? "more ways through it than can be counted: break it up"
          : "the search ran out of time",
      )
    out.snippet.textContent = ""
    return
  }

  out.verdict.textContent = found.exact
    ? `clearable, ${BANDS[found.band] || found.band}`
    : "clearable, but too big to score exactly"
  out.verdict.className = "verdict good"
  out.numbers.innerHTML =
    row("dots", dots) +
    row(found.exact ? "par" : "par, at least", found.par) +
    row("floor", found.floor, found.forced ? "every order pays the same" : "") +
    row("orders paying par", found.parPaths) +
    row("chains", found.moves) +
    row("difficulty", found.difficulty.toFixed(1)) +
    row("silent traps", `${found.firstSilent} of ${found.firstMoves} openings`) +
    row("obvious play", found.greedy.clears ? found.greedy.score : "strands the board") +
    row("positions", found.positions.toLocaleString())

  // Ready to paste into src/modes/levels.js, where the test recomputes both numbers - so a par
  // that is only a lower bound is not offered at all.
  if (!found.exact) {
    out.snippet.textContent = ""
    return
  }
  const lines = asLayout(collapsed())
    .map((line) => `      "${line}",`)
    .join("\n")
  out.snippet.textContent =
    `  {\n    name: "?",\n    par: ${found.par},\n    floor: ${found.floor},\n` +
    `    layout: [\n${lines}\n    ],\n  },`
}

function row(name, value, note = "") {
  return (
    `<div class="row"><span>${name}</span><b>${value}</b>` +
    (note ? `<i>${note}</i>` : "") +
    "</div>"
  )
}

document.getElementById("copy").addEventListener("click", async () => {
  if (!out.snippet.textContent) {
    return
  }
  await navigator.clipboard.writeText(out.snippet.textContent)
  const button = document.getElementById("copy")
  button.textContent = "copied"
  setTimeout(() => (button.textContent = "copy"), 1200)
})

document.getElementById("paste").addEventListener("click", () => {
  const text = prompt("Paste a layout: seven lines of six characters")
  if (!text) {
    return
  }
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[^0-9.]/g, ""))
    .filter((line) => line.length >= PUZZLE_COLS)
  if (lines.length >= PUZZLE_ROWS) {
    loadLayout(lines.slice(0, PUZZLE_ROWS))
  }
})

document.getElementById("clear").addEventListener("click", () => {
  cells.fill(EMPTY)
  changed()
})

document.getElementById("fall").addEventListener("click", () => {
  showFall = !showFall
})

// The same debug handle the game keeps, for the same reason: a console or a test can drive the
// editor without reaching into module scope.
window.__editor = {
  cells,
  layout: () => asLayout(),
  fallen: () => asLayout(collapsed()),
  dots: () => [...cells].filter((value) => value !== EMPTY).length,
  latest: () => latest,
}

// Checked per frame, for the same reason main.js does it: a ResizeObserver whose callback
// resizes the canvas can fire itself, and a browser zoom is what starts it.
view.resize()
;(function loop() {
  view.resize()
  draw()
  requestAnimationFrame(loop)
})()
render()
