// Input, as intent. The mapping layers are pure or take fake events, so what a key
// or a button means is testable without a browser or a device.

import test from "node:test"
import assert from "node:assert/strict"

import { DirectionRepeater, KeyboardInput } from "../src/input.js"
import { readPad, padInUse, GamepadInput } from "../src/gamepad.js"
import { Game } from "../src/game.js"
import { GAMEPAD, REPEAT_DELAY, REPEAT_RATE, freshBindings } from "../src/config.js"

const key = (code, repeat = false) => ({ code, repeat, preventDefault() {} })

// A pad with nothing pressed and both sticks centred.
function blankPad(buttonCount = 16) {
  return { buttons: new Array(buttonCount).fill({ pressed: false, value: 0 }), axes: [0, 0, 0, 0] }
}
function press(pad, index) {
  pad.buttons[index] = { pressed: true, value: 1 }
  return pad
}

test("a held direction fires once, waits, then repeats", () => {
  const repeater = new DirectionRepeater()
  const fired = []
  const fire = (dx, dy) => fired.push([dx, dy])

  repeater.step({ right: true }, 1 / 60, fire)
  assert.equal(fired.length, 1, "the first step is immediate")

  // Nothing for the length of the delay.
  let elapsed = 0
  while (elapsed < REPEAT_DELAY - 2 / 60) {
    repeater.step({ right: true }, 1 / 60, fire)
    elapsed += 1 / 60
  }
  assert.equal(fired.length, 1, "and nothing during the delay")

  repeater.step({ right: true }, 4 / 60, fire)
  assert.equal(fired.length, 2, "then a second")
  assert.deepEqual(fired[1], [1, 0])

  repeater.step({ right: true }, REPEAT_RATE, fire)
  assert.equal(fired.length, 3, "and the rest at the repeat rate")

  repeater.step({}, 1 / 60, fire)
  repeater.step({ right: true }, 1 / 60, fire)
  assert.equal(fired.length, 4, "letting go and pressing again is immediate")
})

test("a pad reads as intent, from either the d-pad or the stick", () => {
  const bound = freshBindings().buttons

  const dpad = readPad(press(blankPad(), GAMEPAD.buttons.dpadLeft), bound)
  assert.equal(dpad.left, true)
  assert.equal(dpad.right, false)

  const stick = blankPad()
  stick.axes[GAMEPAD.axes.y] = 0.9
  assert.equal(readPad(stick, bound).down, true, "the stick moves the cursor too")

  const resting = blankPad()
  resting.axes[GAMEPAD.axes.x] = GAMEPAD.deadzone * 0.5
  assert.equal(readPad(resting, bound).right, false, "a resting stick does not drift")
  assert.equal(padInUse(readPad(resting, bound)), false)
})

test("which pad button links comes from the bindings", () => {
  const bound = freshBindings().buttons
  const pad = press(blankPad(), bound.link)
  assert.equal(readPad(pad, bound).link, true)
  assert.equal(
    readPad(pad, { ...bound, link: 5 }).link,
    false,
    "rebound, it is not the same button",
  )
  assert.deepEqual(readPad(pad, bound).pressed, [bound.link], "and the raw press is reported")
})

test("a control with nothing bound to it simply reads as not held", () => {
  const state = readPad(blankPad(), {})
  assert.equal(state.link, false)
  assert.equal(state.cancel, false)
})

test("keys drive the same intents the pad does", () => {
  const game = new Game()
  game.start("classic")
  for (let i = 0; i < 300; i++) {
    game.advance(1 / 60)
  }
  const keyboard = new KeyboardInput(game)
  const before = { ...game.player.cursor }

  keyboard.onKeyDown(key("ArrowRight"))
  keyboard.poll(1 / 60)
  assert.equal(game.player.cursor.col, before.col + 1, "the cursor moved once")
  keyboard.poll(1 / 60)
  assert.equal(game.player.cursor.col, before.col + 1, "and not again inside the delay")
  keyboard.onKeyUp(key("ArrowRight"))

  keyboard.onKeyDown(key("Space"))
  assert.equal(game.player.chain.length, 1, "space starts a chain")
  keyboard.onKeyDown(key("KeyX"))
  assert.equal(game.player.chain.length, 0, "and X drops it")
})

test("escape opens the menu and backs out of it", () => {
  const game = new Game()
  game.start("classic")
  const keyboard = new KeyboardInput(game)
  keyboard.onKeyDown(key("Escape"))
  assert.equal(game.page, "pause")
  keyboard.onKeyDown(key("Escape"))
  assert.equal(game.page, null)
})

test("a menu row waiting for a key takes the next one, and never a reserved one", () => {
  const game = new Game()
  const keyboard = new KeyboardInput(game)
  game.rebinding = { device: "keys", control: "link" }

  keyboard.onKeyDown(key("Enter"))
  assert.deepEqual(game.rebinding, { device: "keys", control: "link" }, "Enter works the menu")

  keyboard.onKeyDown(key("KeyJ"))
  assert.equal(game.rebinding, null, "the wait is over")
  assert.deepEqual(game.bindings.keys.link, ["KeyJ"])
  assert.equal(game.bindingLabel("keys", "link"), "J")
})

test("binding a key takes it off whatever else held it", () => {
  const game = new Game()
  game.rebinding = { device: "keys", control: "link" }
  game.captureBinding("keys", "ArrowUp")
  assert.deepEqual(game.bindings.keys.link, ["ArrowUp"])
  assert.equal(game.bindings.keys.up.includes("ArrowUp"), false, "UP lost the key it used to share")
  assert.ok(game.bindings.keys.up.includes("KeyW"), "but kept its other one")
})

test("escape abandons a wait instead of being captured", () => {
  const game = new Game()
  const keyboard = new KeyboardInput(game)
  const before = [...game.bindings.keys.link]
  game.rebinding = { device: "keys", control: "link" }
  keyboard.onKeyDown(key("Escape"))
  assert.equal(game.rebinding, null)
  assert.deepEqual(game.bindings.keys.link, before)
})

test("a pad binding is taken when the button comes back up", () => {
  const game = new Game()
  const pads = new GamepadInput(game)
  game.rebinding = { device: "buttons", control: "link" }

  // Down: nothing is taken yet.
  pads.apply(0, readPad(press(blankPad(), 4), game.bindings.buttons), 1 / 60)
  assert.ok(game.rebinding, "still waiting")
  // Up: that is the binding.
  pads.apply(0, readPad(blankPad(), game.bindings.buttons), 1 / 60)
  assert.equal(game.rebinding, null)
  assert.equal(game.bindings.buttons.link, 4)
})

test("the pad button that opens the menu cannot be bound to a control", () => {
  const game = new Game()
  const pads = new GamepadInput(game)
  const before = game.bindings.buttons.link
  game.rebinding = { device: "buttons", control: "link" }

  pads.apply(0, readPad(press(blankPad(), GAMEPAD.buttons.pause), game.bindings.buttons), 1 / 60)
  pads.apply(0, readPad(blankPad(), game.bindings.buttons), 1 / 60)
  assert.equal(game.bindings.buttons.link, before, "the binding is unchanged")
})

test("a pad press starts a chain and a second one pops it", () => {
  const game = new Game()
  game.start("classic")
  for (let i = 0; i < 300; i++) {
    game.advance(1 / 60)
  }
  const pads = new GamepadInput(game)
  const bound = game.bindings.buttons
  const pair = game.board.matchingPairs(1)[0]
  game.player.cursor = { col: pair[0].col, row: pair[0].row }

  const tap = () => {
    pads.apply(0, readPad(press(blankPad(), bound.link), bound), 1 / 60)
    pads.apply(0, readPad(blankPad(), bound), 1 / 60)
  }
  tap()
  assert.equal(game.player.chain.length, 1)
  game.extendTo(0, pair[1].col, pair[1].row)
  tap()
  assert.equal(game.player.chain.length, 0)
  assert.ok(game.player.score > 0, "it was spent, not dropped")
})
