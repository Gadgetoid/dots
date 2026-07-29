// The sound engine, against a stub audio device.
//
// Every voice is wrapped in a try/catch, because audio is best-effort and a stray
// exception in the game loop would be worse than silence. That makes a browser a
// bad place to notice a mistake in here, so the device is faked and what the engine
// asked for is inspected directly.

import test from "node:test"
import assert from "node:assert/strict"

import { Sound } from "../src/audio.js"

class FakeParam {
  constructor() {
    this.value = 0
    this.events = []
  }
  setValueAtTime(value, at) {
    this.events.push({ kind: "set", value, at })
    this.value = value
    return this
  }
  exponentialRampToValueAtTime(value, at) {
    this.events.push({ kind: "ramp", value, at })
    return this
  }
  setTargetAtTime(value, at, constant) {
    this.events.push({ kind: "target", value, at, constant })
    return this
  }
}

class FakeNode {
  constructor(kind, device) {
    this.kind = kind
    this.device = device
    this.gain = new FakeParam()
    this.frequency = new FakeParam()
    this.Q = new FakeParam()
    this.outputs = []
    this.started = null
    this.stopped = null
  }
  connect(target) {
    this.outputs.push(target)
    return target
  }
  start(at) {
    this.started = at
    this.device.started.push(this)
  }
  stop(at) {
    this.stopped = at
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 0
    this.sampleRate = 48000
    this.state = "running"
    this.destination = new FakeNode("destination", this)
    this.nodes = []
    this.started = []
  }
  #make(kind) {
    const node = new FakeNode(kind, this)
    this.nodes.push(node)
    return node
  }
  createOscillator() {
    return this.#make("oscillator")
  }
  createGain() {
    return this.#make("gain")
  }
  createBiquadFilter() {
    return this.#make("filter")
  }
  createWaveShaper() {
    return this.#make("shaper")
  }
  createBufferSource() {
    return this.#make("source")
  }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) }
  }
  resume() {
    return Promise.resolve()
  }
}

// A fresh device before each test, so one test's nodes are never another's.
function fakeDevice() {
  const ctx = new FakeContext()
  globalThis.window = { AudioContext: FakeContext }
  Sound.ctx = ctx
  Sound.chain = null
  Sound.unlocked = true
  Sound.enabled = true
  return ctx
}

const oscillators = (ctx) => ctx.nodes.filter((node) => node.kind === "oscillator")

test("nothing is played while sound is off", () => {
  const ctx = fakeDevice()
  Sound.enabled = false
  Sound.pop(0)
  Sound.link(0)
  Sound.fail()
  assert.equal(oscillators(ctx).length, 0)
})

test("a pop is a note plus a breath of noise", () => {
  const ctx = fakeDevice()
  Sound.pop(0)
  const notes = oscillators(ctx)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].type, "sine")
  assert.equal(notes[0].started, 0)
  assert.equal(ctx.nodes.filter((node) => node.kind === "source").length, 1, "and the noise burst")
})

test("a chain walks up the scale as it unzips", () => {
  const ctx = fakeDevice()
  for (let index = 0; index < 5; index++) {
    Sound.pop(index, index * 0.045)
  }
  const notes = oscillators(ctx)
  assert.equal(notes.length, 5)
  const pitches = notes.map((note) => note.frequency.events[0].value)
  for (let i = 1; i < pitches.length; i++) {
    assert.ok(pitches[i] > pitches[i - 1], `note ${i} is above note ${i - 1}`)
  }
  // And each one is scheduled later than the last, so the run is laid out in one go
  // rather than a note per frame.
  const starts = notes.map((note) => note.started)
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] > starts[i - 1])
  }
})

test("every envelope has an attack, so nothing clicks", () => {
  const ctx = fakeDevice()
  Sound.pop(0)
  Sound.link(2)
  Sound.land(1)
  Sound.fail()
  for (const node of ctx.nodes.filter(
    (entry) => entry.kind === "gain" && entry.gain.events.length,
  )) {
    const [first, second] = node.gain.events
    if (first.kind !== "set") {
      continue // the master gain, which is set once and left alone
    }
    assert.ok(first.value <= 0.001, "it starts from silence")
    assert.ok(second && second.kind === "ramp" && second.at > first.at, "and ramps up")
  }
})

test("the mix goes through the master gain, a low-pass and the soft clip", () => {
  const ctx = fakeDevice()
  Sound.pop(0)
  const master = Sound.chain.gain
  const warmth = master.outputs[0]
  assert.equal(warmth.kind, "filter")
  assert.equal(warmth.type, "lowpass")
  const shaper = warmth.outputs[0]
  assert.equal(shaper.kind, "shaper")
  assert.equal(shaper.outputs[0], ctx.destination)
  // The curve is linear below the threshold and never runs past full scale.
  assert.ok(shaper.curve.every((value) => Math.abs(value) <= 1))
  assert.equal(shaper.curve[shaper.curve.length - 1] > 0.6, true)
})

test("the volume setting reaches the master gain in place", () => {
  fakeDevice()
  Sound.pop(0)
  Sound.setVolume(0.5)
  assert.ok(Sound.chain.gain.gain.value > 0, "still audible")
  Sound.setVolume(0)
  assert.equal(Sound.chain.gain.gain.value, 0)
  Sound.setVolume(1)
})
