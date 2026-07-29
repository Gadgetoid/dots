// Capture screenshots of the real game through the real WebGL backend, so what a
// shot shows is what it ships with and a change to the look is one command away
// from being seen.
//
// Also the smoke test: it fails on a shader that will not compile, a module that
// will not load or an exception in the first frames, none of which a unit test can
// see. Any console error or page error is reported and sets the exit code.
//
// Needs a browser and puppeteer-core, neither of which the game depends on:
//
//   npm install --no-save puppeteer-core
//   node tools/screenshot.mjs
//
// Output lands in screenshots/.

import puppeteer from "puppeteer-core"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "screenshots")

// Where to find a browser. CHROME overrides it.
const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean)

// The field is 600x800, so that is the size a shot is honest at.
const W = 600
const H = 800

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
}

// One entry per shot. `pose` runs in the page with the debug handle, and is
// followed by `frames` frames of simulation so springs and particles are mid-flight
// rather than at rest.
const SHOTS = [
  {
    file: "title.png",
    theme: "dark",
    frames: 40,
    pose: `(game) => {}`,
  },
  {
    file: "board.png",
    theme: "dark",
    frames: 90,
    pose: `(game) => {
      game.start("classic")
      game.settle(2)
      // A chain along a row of one colour, however the board was dealt: find the
      // longest run there is and link it.
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
      game.player.score = 4820
      game.player.multiplier = 3
    }`,
  },
  {
    file: "popping.png",
    theme: "dark",
    frames: 8,
    pose: `(game) => {
      game.start("classic")
      game.settle(2)
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
      game.player.score = 4820
      game.popChain(0)
    }`,
  },
  {
    file: "light.png",
    theme: "light",
    frames: 90,
    pose: `(game) => {
      game.start("endless")
      game.settle(2)
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
      game.player.score = 1290
    }`,
  },
  {
    file: "menu.png",
    theme: "dark",
    frames: 30,
    pose: `(game) => {
      game.start("long")
      game.settle(2)
      game.togglePause()
    }`,
  },
  {
    // An authored level, which is the one board in the game with a designed shape and
    // empty cells in it.
    file: "puzzle.png",
    theme: "dark",
    frames: 90,
    pose: `(game) => {
      game.start("puzzle")
      game.level = 2
      game.retryLevel()
      game.settle(2)
      game.player.score = 640
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
    }`,
  },
  {
    // The mode grid, which is what "new game" opens: the one page whose whole job is
    // to be pressed.
    file: "modes.png",
    theme: "dark",
    frames: 30,
    // Hovering the puzzle mode, whose first level is six dots along the bottom of the
    // board: the shot is the only way to see that the frosted panel really does show
    // what a mode looks like behind it.
    pose: `(game, art) => {
      art.press(game, "modes")
      game.menuAdjust(6)
      game.settle(1)
    }`,
  },
  {
    // Everything a player can change about how the game looks, sounds and plays, over a
    // board frosted behind it.
    file: "settings.png",
    theme: "dark",
    frames: 30,
    pose: `(game, art) => {
      game.start("endless")
      game.settle(2)
      game.togglePause()
      art.press(game, "settings")
      // On the row that says how a chain is gathered, which is the one worth reading.
      game.menuMove(1)
      game.menuMove(1)
      game.menuMove(1)
    }`,
  },
  {
    // The hint: a board sat in front of for long enough points at a chain, and the
    // wobble is what does the pointing.
    file: "hint.png",
    theme: "dark",
    frames: 6,
    pose: `(game, art) => {
      game.start("classic")
      game.settle(3)
      game.player.score = 512
      // Caught the moment the board runs out of patience, so the wobble is still fresh.
      art.until(game, () => game.hint != null)
    }`,
  },
  {
    // The rebinding page, which is the longest menu there is: worth a shot to see
    // that it still fits the field.
    file: "controls.png",
    theme: "dark",
    frames: 20,
    pose: `(game, art) => {
      game.start("classic")
      game.settle(2)
      game.togglePause()
      art.press(game, "settings")
      art.press(game, "controls")
      game.menuMove(1)
      game.menuMove(1)
    }`,
  },
  {
    file: "over.png",
    theme: "light",
    // Long enough to cover the pause a dead board sits there for before the game
    // says so.
    frames: 140,
    pose: `(game) => {
      game.start("clearout")
      game.settle(2)
      game.player.score = 8640
      // Most of the board taken off, which is what the end of a clear-out looks
      // like, and then what is left dealt so nothing matches.
      game.board.remove(game.board.dots.slice(0, game.board.count - 7))
      game.board.collapse()
      game.settle(3)
      // A checkerboard, so no two neighbours can possibly match: colouring by
      // position is the only way to be sure of that whatever survived where.
      for (const dot of game.board.dots) {
        dot.colour = (dot.col + dot.row) % 2
      }
    }`,
  },
  {
    // A reduced-motion session: no particles thrown by a pop, and a menu that is a plain
    // fill rather than glass. Both halves of the setting in one picture.
    file: "reduced.png",
    theme: "dark",
    frames: 20,
    pose: `(game) => {
      game.settings.motion = "reduced"
      game.start("classic")
      game.settle(3)
      game.player.score = 1720
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
      game.popChain(0)
      game.settle(1)
      game.togglePause()
    }`,
  },
  {
    // The brightness setting at its lowest, which is the whole frame scaled in the
    // composite pass: the shot is the only way to see that the board is still
    // legible once it has been turned down for the evening.
    file: "night.png",
    theme: "dark",
    frames: 60,
    pose: `(game) => {
      game.settings.brightness = 0
      game.start("rush")
      game.settle(2)
      game.timeLeft = 12
      const chain = game.board.longestChain()
      game.player.cursor = { col: chain[0].col, row: chain[0].row }
      game.startChain(0)
      for (let i = 1; i < chain.length; i++) {
        game.extendTo(0, chain[i].col, chain[i].row)
      }
      game.player.score = 2360
    }`,
  },
]

function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost")
    const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname)
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" })
    fs.createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => server.listen(0, () => resolve(server)))
}

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`no browser found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}`)
}

const server = await serve()
const port = server.address().port
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: [
    "--enable-unsafe-swiftshader", // a headless browser has no GPU to speak of
    "--use-gl=angle",
    "--hide-scrollbars",
    "--mute-audio",
  ],
})

let problems = 0
try {
  for (const shot of SHOTS) {
    // A context of its own per shot: the game remembers its settings in IndexedDB, so
    // sharing one would leave each shot inheriting the mode and theme of the shot
    // before it, and the pictures would depend on the order they were taken in.
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    page.on("console", (message) => {
      if (message.type() === "error") {
        problems++
        console.error(`[${shot.file}] console: ${message.text()}`)
      }
    })
    page.on("pageerror", (error) => {
      problems++
      console.error(`[${shot.file}] page error: ${error.message}`)
    })
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "load" })
    await page.waitForFunction("window.__dots && window.__dots.game")
    // Pose the scene, then step the loop by hand: the game's own rAF loop is left
    // running, but a fixed number of fixed-length frames is what makes a shot the
    // same picture every time.
    await page.evaluate(
      (theme, pose, frames) => {
        const { game, view, renderer } = window.__dots
        game.settings.theme = theme
        // Settling a board by hand, so a shot never catches it mid-drop unless it
        // means to.
        game.settle = (seconds) => {
          for (let i = 0; i < seconds * 60; i++) {
            game.advance(1 / 60)
          }
        }
        // Menu rows are data and their ids are an implementation detail, so a pose says
        // which button it wants by the action the button performs.
        const art = {
          // Advance until something is true, for a shot that wants to catch a moment
          // rather than a fixed time - the hint fires on its own schedule.
          until(target, ready, seconds = 20) {
            for (let i = 0; i < seconds * 60; i++) {
              target.advance(1 / 60)
              if (ready()) {
                return true
              }
            }
            throw new Error("waited and it never happened")
          },
          press(target, action) {
            const rows = target.menuRows()
            for (const [index, row] of rows.entries()) {
              if (row.kind !== "buttons") {
                continue
              }
              const option = row.options.findIndex((cell) => cell && cell.action === action)
              if (option >= 0) {
                target.menuIndex = index
                target.menuOption = option
                target.menuConfirm()
                return true
              }
            }
            throw new Error(`no button for ${action}`)
          },
        }
        new Function(`return (${pose})`)()(game, art)
        for (let i = 0; i < frames; i++) {
          game.advance(1 / 60)
        }
        // Stop the clock before drawing, or the game's own loop carries on while the
        // picture is being taken and anything momentary is over by then.
        window.__dots.frozen = true
        view.render(game)
        return renderer.ready
      },
      shot.theme,
      shot.pose,
      shot.frames,
    )
    await page.screenshot({ path: path.join(OUT, shot.file) })
    console.log(`wrote screenshots/${shot.file}`)
    await page.close()
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}

if (problems > 0) {
  console.error(`\n${problems} problem(s) reported by the page`)
  process.exit(1)
}
console.log("\nno errors reported by the page")
