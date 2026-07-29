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

// Whether a key was aimed at a control in the page rather than at the game.
//
// The page holds one control, the spoken-menus toggle, and it is worked with Space or
// Enter - both of which the game takes for itself and calls preventDefault on. Without
// this the toggle could be reached by Tab and then never pressed: the game would take the
// press and confirm whatever the menu cursor was on instead.
function forPageControl(target) {
  return Boolean(
    target &&
    typeof target.closest === "function" &&
    target.closest("button, a[href], input, select, textarea"),
  )
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
    if (forPageControl(event.target)) {
      return
    }
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
    // Enter works whatever the link key is bound to, so a player who has not read the
    // controls page can still press on. It has to release as well, or a chain picked up with
    // it is held for ever: with hold-to-link the release is what spends the chain.
    if (event.code === "Enter") {
      event.preventDefault()
      this.held.add("link")
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
    if (forPageControl(event.target)) {
      return
    }
    const control = event.code === "Enter" ? "link" : this.#controlFor(event.code)
    if (!control) {
      return
    }
    this.held.delete(control)
    if (control === "link") {
      this.game.linkRelease(this.playerIndex)
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
    this.pressedPause = false
    this.activePointer = null
    // Where a drag on the level picker last was, so the next move can scroll by the
    // difference, or null when nothing is being dragged.
    this.dragFrom = null
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
    this.dragFrom = this.game.page === "levels" ? event.clientY : null
    if (this.game.page) {
      const point = this.view.toViewSpace(event.clientX, event.clientY)
      this.pressedRow = point ? this.view.menuRowAt(point.x, point.y) : null
      if (this.pressedRow) {
        this.game.menuIndex = this.pressedRow.index
      }
      return
    }
    // The pause button, which is the only way into the menu for a player holding
    // nothing but the screen.
    const point = this.view.toViewSpace(event.clientX, event.clientY)
    if (point && this.view.pauseButtonAt(point.x, point.y)) {
      this.pressedPause = true
      return
    }
    this.game.pointerDown(this.playerIndex, this.#cellAt(event))
  }

  onMove(event) {
    // A drag over the level picker scrolls it. The ladder is taller than its window and a
    // touch player has no other way down it: the cursor can only reach what is on screen.
    if (this.game.page === "levels" && this.dragFrom !== null) {
      this.view.scrollLevels(this.dragFrom - event.clientY)
      this.dragFrom = event.clientY
      return
    }
    if (this.game.page) {
      // The menu cursor follows the pointer, so a mode can be hovered to read what it
      // is without pressing it. Nothing is applied by hovering: a setting still takes a
      // press, and only the cursor moves.
      const point = this.view.toViewSpace(event.clientX, event.clientY)
      const row = point ? this.view.menuRowAt(point.x, point.y) : null
      if (row) {
        this.game.menuHover(row.index, row.option)
      }
      return
    }
    if (event.pointerId !== this.activePointer) {
      // With no button down a mouse still moves the cursor, which is what shows what a
      // dot is carrying.
      if (event.pointerType === "mouse") {
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
    const scrolled = this.dragFrom !== null && Math.abs(this.dragFrom - event.clientY) > 6
    this.dragFrom = null
    if (scrolled) {
      // A drag that moved the picker is not a press on whatever it started over.
      this.pressedRow = null
      return
    }
    const point = this.view.toViewSpace(event.clientX, event.clientY)
    if (this.pressedPause) {
      this.pressedPause = false
      // Only if it comes up on the button too: a press that slid off it is a change of
      // mind, as it is for a menu row.
      if (point && this.view.pauseButtonAt(point.x, point.y)) {
        this.game.togglePause()
      }
      return
    }
    if (this.game.page) {
      const row = point ? this.view.menuRowAt(point.x, point.y) : null
      const pressed = this.pressedRow
      this.pressedRow = null
      if (row && pressed && row.index === pressed.index && row.option === pressed.option) {
        this.game.menuTap(row.index, row.option)
      }
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
    this.pressedPause = false
    this.game.pointerUp(this.playerIndex)
  }
}
