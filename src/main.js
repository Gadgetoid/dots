// Entry point: wire the DOM, create the renderer, the game and the input devices,
// and run the loop.
//
// The page holds nothing but the canvas. Every control the player has is drawn inside
// the field, because a button in the page can only be pressed by a pointer, and this
// game is played with a finger, a pad or a keyboard just as often.

import { WebGLRenderer } from "./glrenderer.js"
import { GameView } from "./view.js"
import { Game } from "./game.js"
import { KeyboardInput, PointerInput } from "./input.js"
import { GamepadInput } from "./gamepad.js"
import { Sound } from "./audio.js"

const canvas = document.getElementById("game")
const renderer = WebGLRenderer.create(canvas)
// WebGL2 is the only backend. Say so plainly instead of leaving a black screen.
if (!renderer) {
  document.getElementById("screen").innerHTML =
    '<p class="unsupported">WebGL2 required<br /><small>This browser could not' +
    " create a WebGL2 context.</small></p>"
  throw new Error("WebGL2 unavailable")
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

// A browser only opens an audio device inside a real user gesture, and there is no
// button in the page to be the gesture: the first touch of the board or the first key
// is. Kept listening rather than run once, because sound may be off to begin with and
// the gesture that turns it on is the one that has to open the device.
function unlockAudio() {
  if (game.settings.sound) {
    Sound.ensureContext()
  }
}
canvas.addEventListener("pointerdown", unlockAudio)
addEventListener("keydown", unlockAudio)

// The page around the canvas follows the theme, so the frame and the field never
// disagree about whether it is night. Cheap enough to check every frame, and it means
// a change from any source lands the same way.
let appliedTheme = null
function syncTheme() {
  if (appliedTheme === game.settings.theme) {
    return
  }
  appliedTheme = game.settings.theme
  const theme = game.theme
  document.documentElement.style.colorScheme = theme.id === "dark" ? "dark" : "light"
  document.body.style.background = theme.page
  document.body.style.color = theme.text.dim
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme.page)
}

function resize() {
  view.resize(canvas.getBoundingClientRect())
}
new ResizeObserver(resize).observe(canvas)
resize()

// Pause audio while the tab is hidden. Background frames are skipped in the loop, so
// nothing simulates either.
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
  syncTheme()
  game.advance(dt)
  // The simulation still runs while a lost GPU context is being restored.
  if (renderer.ready) {
    view.render(game)
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
