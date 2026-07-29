// Entry point: wire the DOM, create the renderer, the game and the input devices,
// and run the loop.

import { WebGLRenderer } from "./glrenderer.js"
import { GameView } from "./view.js"
import { Game } from "./game.js"
import { KeyboardInput, PointerInput } from "./input.js"
import { GamepadInput } from "./gamepad.js"
import { Sound } from "./audio.js"
import { CONFIG } from "./config.js"
import { THEME_IDS } from "./palette.js"

const canvas = document.getElementById("game")
const renderer = WebGLRenderer.create(canvas)
// WebGL2 is the only backend. Say so plainly instead of leaving a black screen.
if (!renderer) {
  document.getElementById("screen").innerHTML =
    '<p class="unsupported">WEBGL2 REQUIRED<br /><small>This browser could not' +
    " create a WebGL2 context.</small></p>"
  throw new Error("WebGL2 unavailable")
}

// ?fullscreen drops the page frame and the help line so the canvas owns the
// screen, for a handheld or a kiosk.
const OPTIONS = new URLSearchParams(location.search)
if (OPTIONS.has("fullscreen")) {
  document.body.classList.add("fullscreen")
}

const view = new GameView(renderer)
const game = new Game()
const keyboard = new KeyboardInput(game)
const pointer = new PointerInput(game, view)
const gamepad = new GamepadInput(game)
pointer.attach(canvas)

// Debug handle: lets the console and any smoke test drive live state without
// reaching into module scope.
window.__dots = { game, view, renderer, keyboard, pointer, gamepad }

addEventListener("keydown", (event) => keyboard.onKeyDown(event))
addEventListener("keyup", (event) => keyboard.onKeyUp(event))
addEventListener("blur", () => keyboard.onBlur())

// The help line names whichever device is in use. All three are in the page, so the
// swap costs nothing and none of them has to be built in script.
const helpFor = {
  keyboard: document.getElementById("helpKeys"),
  gamepad: document.getElementById("helpPad"),
  touch: document.getElementById("helpTouch"),
  pointer: document.getElementById("helpTouch"),
}
let shownHelp = null
function syncHelp() {
  if (shownHelp === game.inputMode) {
    return
  }
  shownHelp = game.inputMode
  const wanted = helpFor[shownHelp] || helpFor.keyboard
  for (const element of new Set(Object.values(helpFor))) {
    element.hidden = element !== wanted
  }
}

// Settings live on the game so the menu can work them without knowing about the
// renderer or the DOM; this is where they reach the page. Cheap enough to check
// every frame, and it means a change from any source lands the same way.
const applied = { theme: null, brightness: null, sound: null }
const themeButton = document.getElementById("btnTheme")
const brightButton = document.getElementById("btnBright")
const soundButton = document.getElementById("btnSound")

function syncSettings() {
  if (applied.theme !== game.settings.theme) {
    applied.theme = game.settings.theme
    const theme = game.theme
    // The page around the canvas follows the theme, so the frame and the field
    // never disagree about whether it is night.
    document.documentElement.style.colorScheme = theme.id === "dark" ? "dark" : "light"
    document.body.style.background = theme.page
    document.body.style.color = theme.text.dim
    themeButton.textContent = theme.name
    themeButton.setAttribute("aria-pressed", String(theme.id === "dark"))
  }
  if (applied.brightness !== game.settings.brightness) {
    applied.brightness = game.settings.brightness
    brightButton.textContent = game.brightness.name
    brightButton.title = `Brightness: ${game.brightness.name}`
    brightButton.setAttribute(
      "aria-pressed",
      String(game.brightness.value >= CONFIG.BRIGHTNESS_LEVELS.at(-1).value),
    )
  }
  if (applied.sound !== game.settings.sound) {
    applied.sound = game.settings.sound
    soundButton.setAttribute("aria-pressed", String(game.settings.sound))
  }
}

themeButton.addEventListener("click", (event) => {
  const next = THEME_IDS[(THEME_IDS.indexOf(game.settings.theme) + 1) % THEME_IDS.length]
  game.setTheme(next)
  event.currentTarget.blur()
})

brightButton.addEventListener("click", (event) => {
  game.stepBrightness(1)
  event.currentTarget.blur()
})

// A browser only opens an audio device inside a real pointer gesture, and a pad
// button is not one, so this button is the only thing that can unlock sound for a
// player holding only a pad. It stays in the page for that reason.
soundButton.addEventListener("click", (event) => {
  game.setSound(!game.settings.sound)
  if (game.settings.sound) {
    Sound.ensureContext()
  }
  event.currentTarget.blur()
})

function resize() {
  view.resize(canvas.getBoundingClientRect())
}
new ResizeObserver(resize).observe(canvas)
resize()

// Pause audio while the tab is hidden. Background frames are skipped in the loop,
// so nothing simulates either.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (Sound.ctx && Sound.ctx.suspend) {
      Sound.ctx.suspend()
    }
    keyboard.onBlur()
  } else if (Sound.enabled && Sound.ctx && Sound.ctx.resume) {
    Sound.ctx.resume().catch(() => {})
  }
})

let last = 0
function loop(timestamp) {
  if (!last) {
    last = timestamp
  }
  let dt = (timestamp - last) / 1000
  last = timestamp
  if (document.hidden) {
    requestAnimationFrame(loop)
    return
  }
  // Clamp so a stalled tab does not drop a board through the floor.
  if (dt > 0.05) {
    dt = 0.05
  }
  // Polled devices are sampled before the step they drive.
  keyboard.poll(dt)
  gamepad.poll(dt)
  syncHelp()
  syncSettings()
  game.advance(dt)
  // The simulation still runs while a lost GPU context is being restored.
  if (renderer.ready) {
    view.render(game)
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
