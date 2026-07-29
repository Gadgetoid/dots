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
import { Speech } from "./speech.js"

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

// Debug handle: lets the console and any smoke test drive live state without reaching
// into module scope. `frozen` stops the loop where it is, which is what a screenshot
// needs: without it the loop keeps running after a scene is posed, and anything that only
// lasts a moment - a hint wobbling, a chain bursting - is over before the picture is
// taken.
window.__dots = { game, view, renderer, keyboard, pointer, gamepad, frozen: false }

// A browser only opens an audio device inside a real user gesture, and there is no button
// in the page to be the gesture: the first touch of the board or the first key is. Sound is
// on by default, so this is all a first-time player has to do to hear the game - the gesture
// is noted whether or not sound is on at the time, so turning it on later needs no gesture
// of its own. On the window rather than the canvas: the letterbox either side of the field
// and the spoken-menus toggle are presses too.
//
// Kept listening rather than run once, because a device that has been opened and lost - a
// tab suspended, output changed - is reopened by the next thing the player does.
function unlockAudio() {
  Sound.gestured = true
  if (game.settings.sound) {
    Sound.ensureContext()
  }
}
// In the capture phase, so the device is open before the press is played: the canvas has
// its own pointer handler and it would otherwise run first, and the sound that press makes
// would be the one sound lost.
addEventListener("pointerdown", unlockAudio, { capture: true })
addEventListener("keydown", unlockAudio, { capture: true })

addEventListener("keydown", (event) => keyboard.onKeyDown(event))
addEventListener("keyup", (event) => keyboard.onKeyUp(event))
addEventListener("blur", () => keyboard.onBlur())

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

// The spoken-menus toggle in the page. The field is a canvas and a canvas cannot be read
// out, so the setting drawn inside it can only be found by someone who can see it: this is
// the same setting, in the one place a screen reader will announce without being asked.
// Turning it on hands focus to the field, so the next key played is a move and not another
// press of this.
const speakToggle = document.getElementById("speak")
speakToggle.addEventListener("click", () => {
  const on = game.setSpeech(!game.speechOn)
  if (on) {
    canvas.focus()
  }
})

// Kept in step with the setting whichever of the two was used to change it, so the button
// never announces the opposite of what the game is doing.
let appliedSpeech = null
function syncSpeech() {
  if (appliedSpeech === game.speechOn) {
    return
  }
  appliedSpeech = game.speechOn
  speakToggle.setAttribute("aria-pressed", appliedSpeech ? "true" : "false")
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
    // Speech carries on talking to an empty room otherwise: it is not part of the audio
    // context and suspending that does not stop it.
    Speech.silence()
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
  if (document.hidden || window.__dots.frozen) {
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
  syncSpeech()
  game.advance(dt)
  // The simulation still runs while a lost GPU context is being restored.
  if (renderer.ready) {
    view.render(game)
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
