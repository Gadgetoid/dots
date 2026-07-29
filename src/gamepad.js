// Gamepad input.
//
// The Gamepad API is polled rather than evented, so a pad is sampled once a frame
// and turned into the same intents the keyboard produces. Directions come off the
// D-pad and the left stick, both fixed, and repeat through the same repeater the
// keyboard uses. Which button links and which drops a chain is the player's
// business and comes from the bindings table.
//
// Pads are read by their slot in navigator.getGamepads, and slot n drives player n.
// Only the first is played today; the rest are polled and their intents thrown at
// player slots that do not exist yet, which is why every device method takes a
// player index.

import { GAMEPAD, RESERVED_BUTTONS } from "./config.js"
import { DirectionRepeater } from "./input.js"
import { MAX_PLAYERS } from "./game.js"

// How far a button is pressed, 0..1. A standard-mapping entry is an object with
// both a flag and an analog value; older mappings expose a bare number.
function buttonTravel(pad, index) {
  const button = pad.buttons ? pad.buttons[index] : undefined
  if (button == null) {
    return 0
  }
  if (typeof button === "number") {
    return button
  }
  return button.pressed ? 1 : button.value || 0
}

// Every mapped control, as intent rather than as hardware. Pure, so the mapping is
// testable without a browser or a device.
export function readPad(pad, bound = {}) {
  const buttons = GAMEPAD.buttons
  const axis = (index) => (pad.axes && pad.axes[index]) || 0
  const held = (index) =>
    index !== undefined && buttonTravel(pad, index) >= GAMEPAD.triggerThreshold
  const stickX = axis(GAMEPAD.axes.x)
  const stickY = axis(GAMEPAD.axes.y)
  // Every button past the threshold, so a rebind can see what was pressed without
  // the mapping standing in the way.
  const pressed = []
  const count = pad.buttons ? pad.buttons.length : 0
  for (let index = 0; index < count; index++) {
    if (buttonTravel(pad, index) >= GAMEPAD.triggerThreshold) {
      pressed.push(index)
    }
  }
  return {
    up: held(buttons.dpadUp) || stickY <= -GAMEPAD.deadzone,
    down: held(buttons.dpadDown) || stickY >= GAMEPAD.deadzone,
    left: held(buttons.dpadLeft) || stickX <= -GAMEPAD.deadzone,
    right: held(buttons.dpadRight) || stickX >= GAMEPAD.deadzone,
    link: held(bound.link),
    cancel: held(bound.cancel),
    // The fixed pair: START confirms and BACK opens the menu, so a rebind can
    // never leave a player unable to reach it.
    confirm: held(buttons.confirm),
    pause: held(buttons.pause),
    pressed,
  }
}

// Is the player touching the pad at all? Drives the switch of on-screen prompts,
// so it must not trip on a resting stick, which is what the deadzone is for.
export function padInUse(state) {
  return Boolean(
    state.up ||
    state.down ||
    state.left ||
    state.right ||
    state.link ||
    state.cancel ||
    state.confirm ||
    state.pause,
  )
}

export class GamepadInput {
  constructor(game) {
    this.game = game
    // One sample and one repeater per slot, so two pads never share a cursor.
    this.previous = new Array(MAX_PLAYERS).fill(null)
    this.repeaters = Array.from({ length: MAX_PLAYERS }, () => new DirectionRepeater())
    this.backHeld = 0
    this.holdCancelled = false
    this.heldWhenWaitOpened = null
  }

  poll(dt = 0) {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
      return
    }
    const pads = navigator.getGamepads()
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const pad = pads[slot]
      if (!pad || pad.connected === false) {
        if (this.previous[slot]) {
          this.previous[slot] = null // unplugged mid-game
          this.repeaters[slot].reset()
        }
        continue
      }
      if (slot >= this.game.playerCount) {
        continue // a pad with nobody to drive
      }
      this.apply(slot, readPad(pad, this.game.bindings.buttons), dt)
    }
  }

  // Drive one sample into the game. Separate from polling so a test can feed a
  // sample without a browser.
  apply(slot, state, dt = 0) {
    const game = this.game
    const before = this.previous[slot]
    const pressed = (field) => state[field] && !(before && before[field])
    if (padInUse(state)) {
      game.inputMode = "gamepad"
    }
    if (state.cancel) {
      this.backHeld += dt
    } else {
      this.backHeld = 0
      this.holdCancelled = false
    }

    // A row waiting for a button takes it when it comes back up, which is what lets
    // the cancel button be bound like any other: a tap fills the row, and holding it
    // abandons the wait instead.
    if (game.rebinding && game.rebinding.device === "buttons") {
      if (!this.heldWhenWaitOpened) {
        // Whatever was already down when the row started waiting - the button that
        // chose it - must not be taken by the release that follows.
        this.heldWhenWaitOpened = new Set(before ? before.pressed : [])
      }
      if (pressed("pause")) {
        game.cancelRebind()
        this.previous[slot] = state
        return
      }
      if (state.cancel && this.backHeld >= GAMEPAD.rebindCancelHold && !this.holdCancelled) {
        this.holdCancelled = true
        game.cancelRebind()
        this.previous[slot] = state
        return
      }
      for (const index of before ? before.pressed : []) {
        if (state.pressed.includes(index) || RESERVED_BUTTONS.has(index)) {
          continue // still held, or not something that can be bound
        }
        if (this.heldWhenWaitOpened.delete(index)) {
          continue // left over from choosing the row
        }
        if (game.captureBinding("buttons", index)) {
          break
        }
      }
      this.previous[slot] = state
      return
    }
    this.heldWhenWaitOpened = null

    if (pressed("link") || pressed("confirm")) {
      game.linkPress(slot)
    }
    // The release, which is what spends a chain while holding. START is a menu button as
    // well as a spare confirm, so only the bound one is followed down and up.
    if (before && before.link && !state.link) {
      game.linkRelease(slot)
    }
    if (pressed("cancel")) {
      if (game.page) {
        game.menuBack()
      } else {
        game.cancelChain(slot)
      }
    }
    if (pressed("pause")) {
      game.escape()
    }
    this.repeaters[slot].step(state, dt, (dx, dy) => game.moveCursor(slot, dx, dy))

    this.previous[slot] = state
  }
}
