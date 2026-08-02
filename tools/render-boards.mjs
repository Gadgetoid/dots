// Draw a directory of found boards as they would be dealt, so a search can be looked at rather
// than read off a summary line.
//
// Through the real renderer, for the same reason tools/screenshot.mjs is: a board drawn any other
// way is a board drawn by code that will never draw it in the game. It loads the game, poses each
// layout onto it and crops to the field, so what comes out is the board and nothing else - no
// score, no level name, none of the furniture that would be about some other level.
//
// Needs a browser and puppeteer-core, neither of which the game depends on:
//
//   npm install --no-save puppeteer-core
//   node tools/render-boards.mjs found/three
//
// The pictures land in a `boards` directory beside the finds, named as the find files are, so a
// summary line and a picture can be put side by side.

import puppeteer from "puppeteer-core"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { boardLayout } from "../src/config.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../src/modes/levels.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean)

const findBrowser = () => {
  const found = CHROME_CANDIDATES.find((where) => fs.existsSync(where))
  if (!found) {
    console.error(`no browser found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}\nSet CHROME.`)
    process.exit(1)
  }
  return found
}

// The field is 600x800 and the renderer letterboxes into whatever the canvas is, so rendering at
// twice that and cropping to the board's own rectangle gives a picture at a useful size.
const SCALE = 2
const W = 600 * SCALE
const H = 800 * SCALE
// A little air around the board, so the dots at its edge are not against the crop.
const MARGIN = 10 * SCALE

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
}

const where = process.argv[2]
if (!where) {
  console.error("usage: node tools/render-boards.mjs <directory of finds>")
  process.exit(1)
}
const from = path.resolve(where)
const into = path.join(from, "boards")
// Anything not drawn already, so this can be run at a search whenever it is worth a look and
// only pays for what has turned up since.
const drawn = (name) => fs.existsSync(path.join(into, name.replace(/\.json$/, ".png")))
const finds = fs
  .readdirSync(from)
  .filter((name) => name.endsWith(".json") && name !== "state.json" && !drawn(name))
  .sort()
if (finds.length === 0) {
  console.log(`nothing new to draw in ${path.relative(ROOT, from)}`)
  process.exit(0)
}
fs.mkdirSync(into, { recursive: true })

const server = http.createServer((request, response) => {
  const file = path.join(ROOT, decodeURIComponent(request.url.split("?")[0]))
  try {
    response.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    })
    response.end(fs.readFileSync(file))
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((listening) => server.listen(0, listening))
const port = server.address().port

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  args: ["--headless=new", "--use-gl=angle", "--enable-unsafe-swiftshader"],
})
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
const trouble = []
page.on("console", (message) => message.type() === "error" && trouble.push(message.text()))
page.on("pageerror", (error) => trouble.push(String(error)))

await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle0" })
await page.waitForFunction("window.__dots && window.__dots.renderer.ready")

// Where the board sits, which is the crop. The same maths the game lays it out with.
const board = boardLayout(PUZZLE_COLS, PUZZLE_ROWS)
const clip = {
  x: Math.round(board.x * SCALE - MARGIN),
  y: Math.round(board.y * SCALE - MARGIN),
  width: Math.round(board.width * SCALE + MARGIN * 2),
  height: Math.round(board.height * SCALE + MARGIN * 2),
}

for (const name of finds) {
  const find = JSON.parse(fs.readFileSync(path.join(from, name), "utf8"))
  if (!Array.isArray(find.layout)) {
    console.log(`${name}: no layout in it`)
    continue
  }
  await page.evaluate((layout) => {
    const { game } = window.__dots
    window.__dots.frozen = false
    // The puzzle mode, for its board shape and its empty cells, with the found layout dealt onto
    // it in place of the level. Settled, so the dots are where they land rather than mid-fall.
    game.start("puzzle")
    game.board.load(layout)
    // The cursor is drawn wherever it is, and a picture of a board should not have one on it.
    // Parked off the grid rather than turned off, which would mean lying about the phase.
    game.player.cursor = { col: -9, row: -9 }
    for (let frame = 0; frame < 240; frame++) {
      game.advance(1 / 60)
    }
    window.__dots.frozen = true
  }, find.layout)
  // A frame with the pose in it, and then the shot.
  await page.evaluate(() => {
    const { view, game } = window.__dots
    view.render(game)
  })
  const file = path.join(into, name.replace(/\.json$/, ".png"))
  await page.screenshot({ path: file, clip })
  console.log(`${path.relative(ROOT, file)}  ${find.difficulty} ${find.shape}`)
}

await browser.close()
server.close()
if (trouble.length > 0) {
  console.error(`\nthe page complained:\n  ${trouble.join("\n  ")}`)
  process.exit(1)
}
console.log(`\n${finds.length} drawn into ${path.relative(ROOT, into)}`)
