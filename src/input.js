// Keyboard and pointer input.
//
// Nothing here decides what an action means: a key or a tap is turned into one of
// the game's intents (move the cursor, link, cancel, work the menu) and the game
// does the rest. That is what lets a pad, a keyboard and a finger all drive the
// same chain through the same rules.
//
// Every device hands its intents to a player slot. One is played today; a second
// keyboard is not a thing, but a second pad is, so the slot is a parameter rather
// than an assumption.

import { REPEAT_DELAY, REPEAT_RATE, RESERVED_KEYS, cellAt } from "./config.js"

const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

// A held direction fires once immediately, then again after a pause, then at a
// steady rate: the same feel on a keyboard, a D-pad and a stick, from one place.
export class DirectionRepeater {
  constructor() {
    this.timers = { up: 0, down: 0, left: 0, right: 0 }
  }

  reset() {
    for (const key of Object.keys(this.timers)) {
      this.timers[key] = 0
    }
  }

  // `held` says which directions are down; `fire(dx, dy)` is called for each step.
  step(held, dt, fire) {
    for (const [name, [dx, dy]] of Object.entries(DIRECTIONS)) {
      if (!held[name]) {
        this.timers[name] = 0
        continue
      }
      if (this.timers[name] === 0) {
        this.timers[name] = REPEAT_DELAY
        fire(dx, dy)
        continue
      }
      this.timers[name] -= dt
      if (this.timers[name] <= 0) {
        this.timers[name] = REPEAT_RATE
        fire(dx, dy)
      }
    }
  }
}

export class KeyboardInput {
  constructor(game, playerIndex = 0) {
    this.game = game
    this.playerIndex = playerIndex
    this.held = new Set()
    this.repeater = new DirectionRepeater()
  }

  // Which control a key code is bound to, or null. The table is small enough that
  // scanning it per event is cheaper than keeping an index in step with a rebind.
  #controlFor(code) {
    const table = this.game.bindings.keys
    for (const control of Object.keys(table)) {
      const keys = table[control]
      if (Array.isArray(keys) ? keys.includes(code) : keys === code) {
        return control
      }
    }
    return null
  }

  onKeyDown(event) {
    if (event.repeat) {
      // The repeat is the repeater's business, not the browser's: a held key steps
      // the cursor at the game's own rate.
      return
    }
    this.game.inputMode = "keyboard"
    // A row waiting for a key takes the next one that is not reserved, and Escape
    // abandons the wait instead of being captured.
    if (this.game.rebinding && this.game.rebinding.device === "keys") {
      event.preventDefault()
      if (event.code === "Escape") {
        this.game.cancelRebind()
      } else if (!RESERVED_KEYS.has(event.code)) {
        this.game.captureBinding("keys", event.code)
      }
      return
    }
    if (event.code === "Escape") {
      event.preventDefault()
      this.game.escape()
      return
    }
    if (event.code === "Enter") {
      event.preventDefault()
      this.#confirm()
      return
    }
    const control = this.#controlFor(event.code)
    if (!control) {
      return
    }
    event.preventDefault()
    this.held.add(control)
    if (control === "link") {
      this.#confirm()
    } else if (control === "cancel") {
      if (this.game.page) {
        this.game.menuBack()
      } else {
        this.game.cancelChain(this.playerIndex)
      }
    }
  }

  onKeyUp(event) {
    const control = this.#controlFor(event.code)
    if (control) {
      this.held.delete(control)
    }
  }

  // A press means "start, or spend" in play and "confirm" in a menu; the game
  // knows which it is.
  #confirm() {
    this.game.linkPress(this.playerIndex)
  }

  onBlur() {
    this.held.clear()
    this.repeater.reset()
    this.game.onBlur()
  }

  // Once a frame, so a held direction repeats at the game's rate.
  poll(dt) {
    const held = {
      up: this.held.has("up"),
      down: this.held.has("down"),
      left: this.held.has("left"),
      right: this.held.has("right"),
    }
    this.repeater.step(held, dt, (dx, dy) => this.game.moveCursor(this.playerIndex, dx, dy))
  }
}

// Pointer input: a drag across the board is a chain, and a tap on a menu row works
// the menu. This is the only device that needs to know where anything is drawn, so
// it is handed the view.
export class PointerInput {
  constructor(game, view, playerIndex = 0) {
    this.game = game
    this.view = view
    this.playerIndex = playerIndex
    // Which menu row a press went down on, so a tap only counts if it comes up on
    // the same row - a drag off a row is a change of mind.
    this.pressedRow = null
    this.activePointer = null
  }

  attach(canvas) {
    canvas.addEventListener("pointerdown", (event) => this.onDown(event))
    canvas.addEventListener("pointermove", (event) => this.onMove(event))
    canvas.addEventListener("pointerup", (event) => this.onUp(event))
    canvas.addEventListener("pointercancel", (event) => this.onCancel(event))
    // A finger dragging across the board must not scroll the page with it.
    canvas.style.touchAction = "none"
  }

  #cellAt(event) {
    const point = this.view.toViewSpace(event.clientX, event.clientY)
    if (!point || !this.game.board) {
      return null
    }
    return cellAt(this.game.layout, point.x, point.y)
  }

  onDown(event) {
    this.game.inputMode = event.pointerType === "touch" ? "touch" : "pointer"
    this.activePointer = event.pointerId
    if (this.game.page) {
      const point = this.view.toViewSpace(event.clientX, event.clientY)
      this.pressedRow = point ? this.view.menuRowAt(point.x, point.y) : null
      if (this.pressedRow != null) {
        this.game.menuIndex = this.pressedRow
      }
      return
    }
    this.game.pointerDown(this.playerIndex, this.#cellAt(event))
  }

  onMove(event) {
    if (this.game.page || event.pointerId !== this.activePointer) {
      // With no button down a mouse still moves the cursor, which is what shows
      // what a dot is carrying.
      if (!this.game.page && event.pointerType === "mouse") {
        this.game.pointerMove(this.playerIndex, this.#cellAt(event))
      }
      return
    }
    this.game.pointerMove(this.playerIndex, this.#cellAt(event))
  }

  onUp(event) {
    if (event.pointerId !== this.activePointer) {
      return
    }
    this.activePointer = null
    if (this.game.page) {
      const point = this.view.toViewSpace(event.clientX, event.clientY)
      const row = point ? this.view.menuRowAt(point.x, point.y) : null
      if (row != null && row === this.pressedRow) {
        this.game.menuConfirm()
      }
      this.pressedRow = null
      return
    }
    this.game.pointerUp(this.playerIndex)
  }

  onCancel(event) {
    if (event.pointerId !== this.activePointer) {
      return
    }
    this.activePointer = null
    this.pressedRow = null
    this.game.pointerUp(this.playerIndex)
  }
}
