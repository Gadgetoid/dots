// The tunings, and that each mode's is a real one.
//
// A scale here is data the sound engine reads at face value, so a typo in it would be
// a mode that plays something slightly wrong and nothing that fails: worth checking
// that every scale rises, stays inside its octave, and is what it claims to be.

import test from "node:test"
import assert from "node:assert/strict"

import {
  SCALES,
  SCALE_BY_ID,
  RANDOM_ROOTS,
  DEFAULT_TUNING,
  buildTuning,
  resolveTuning,
  noteFrequency,
} from "../src/scales.js"
import { GAME_MODES } from "../src/modes/index.js"
import { Sound } from "../src/audio.js"
import { mulberry32 } from "../src/math.js"

test("a note name is the frequency it should be", () => {
  assert.equal(Math.round(noteFrequency("A4")), 440)
  assert.equal(Math.round(noteFrequency("A3")), 220, "an octave down is half")
  assert.equal(Math.round(noteFrequency("C4")), 262, "middle C")
  assert.equal(Math.round(noteFrequency("G3")), 196)
  // An octave is a doubling, and a sharp is a flat of the note above.
  assert.ok(Math.abs(noteFrequency("Bb3") - noteFrequency("A#3")) < 1e-9)
  assert.throws(() => noteFrequency("H4"), /not a note name/)
})

test("every scale rises inside one octave and starts on the root", () => {
  for (const scale of SCALES) {
    const steps = scale.cents || scale.degrees
    assert.ok(steps.length >= 5, `${scale.id} has enough notes to walk up`)
    assert.equal(steps[0], 0, `${scale.id} starts on its root`)
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i] > steps[i - 1], `${scale.id} rises at step ${i}`)
    }
    const octave = scale.cents ? 1200 : 12
    assert.ok(steps.at(-1) < octave, `${scale.id} stays inside its octave`)
    assert.ok(scale.name && scale.id, `${scale.id} is named`)
  }
})

test("scale ids are unique, and no two scales are the same notes", () => {
  assert.equal(SCALE_BY_ID.size, SCALES.length, "no id is used twice")
  const shapes = new Set()
  for (const scale of SCALES) {
    // Compared in cents, so a scale given in semitones and the same one given in
    // cents would still collide.
    const cents = (scale.cents || scale.degrees.map((step) => step * 100)).join(",")
    assert.equal(shapes.has(cents), false, `${scale.id} is not a duplicate`)
    shapes.add(cents)
  }
})

test("the non-equal-tempered scales really are", () => {
  for (const id of ["slendro", "pelog"]) {
    const scale = SCALE_BY_ID.get(id)
    assert.ok(scale.cents, `${id} is given in cents`)
    assert.ok(
      scale.cents.some((step) => step % 100 !== 0),
      `${id} holds an interval no piano can play, which is the point of it`,
    )
  }
})

test("a tuning is a root and a run of rising ratios", () => {
  const tuning = buildTuning({ root: "A3", scale: "minorPentatonic" })
  assert.equal(Math.round(tuning.rootHz), 220)
  assert.equal(tuning.ratios[0], 1, "the first step is the root itself")
  for (let i = 1; i < tuning.ratios.length; i++) {
    assert.ok(tuning.ratios[i] > tuning.ratios[i - 1], `step ${i} is above step ${i - 1}`)
  }
  // Five notes to the scale, so the sixth step is the root an octave up.
  assert.ok(Math.abs(tuning.ratios[5] - 2) < 1e-9)
  // And it is bounded: a chain of forty dots cannot climb forever.
  assert.ok(tuning.ratios.at(-1) <= 8, "it stops after a couple of octaves")
})

test("an unknown scale falls back rather than throwing", () => {
  const tuning = buildTuning({ root: "C4", scale: "not-a-scale" })
  assert.equal(tuning.scale, DEFAULT_TUNING.scale)
})

test("a mode's tuning is resolved, and random means random", () => {
  const fixed = resolveTuning({ root: "C4", scale: "blues" })
  assert.equal(fixed.scale, "blues")
  assert.equal(Math.round(fixed.rootHz), 262)

  assert.equal(resolveTuning(undefined).scale, DEFAULT_TUNING.scale, "no tuning is the default")

  // A seeded generator, so this asserts the shape rather than hoping for a difference.
  const random = mulberry32(9)
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    const tuning = resolveTuning("random", random)
    assert.ok(SCALE_BY_ID.has(tuning.scale), "it picked a real scale")
    assert.ok(RANDOM_ROOTS.includes(tuning.root), "and a root from the list")
    seen.add(`${tuning.root} ${tuning.scale}`)
  }
  assert.ok(seen.size > 5, "and not the same one every time")
})

test("every mode names a tuning the game can build", () => {
  for (const mode of GAME_MODES) {
    const tuning = resolveTuning(mode.tuning)
    assert.ok(tuning.ratios.length > 0, `${mode.id} resolves`)
    if (mode.tuning && mode.tuning !== "random") {
      assert.ok(
        SCALE_BY_ID.has(mode.tuning.scale),
        `${mode.id} names a scale that exists: ${mode.tuning.scale}`,
      )
      assert.equal(tuning.scale, mode.tuning.scale, `${mode.id} got the scale it asked for`)
      // A root that does not parse throws, which is what this is really checking.
      assert.ok(noteFrequency(mode.tuning.root) > 0, `${mode.id} names a real root`)
    }
  }
})

test("more than one mode sounds different, and one of them is not western", () => {
  const scales = GAME_MODES.filter((mode) => mode.tuning && mode.tuning !== "random").map(
    (mode) => mode.tuning.scale,
  )
  assert.ok(new Set(scales).size >= 4, "the modes do not all sound the same")
  assert.ok(
    scales.some((scale) => SCALE_BY_ID.get(scale).cents),
    "at least one mode plays in something no piano can",
  )
})

test("the sound engine plays whatever tuning it is handed", () => {
  const before = Sound.tuning
  Sound.setTuning(buildTuning({ root: "A3", scale: "minorPentatonic" }))
  assert.equal(Math.round(Sound.note(0)), 220)
  assert.equal(Math.round(Sound.note(1)), 262, "three semitones up the minor pentatonic")

  Sound.setTuning(buildTuning({ root: "A3", scale: "majorPentatonic" }))
  assert.equal(Math.round(Sound.note(1)), 247, "two semitones up the major one")

  // Past the top of the run the pitch holds instead of climbing out of hearing.
  assert.equal(Sound.note(500), Sound.note(Sound.tuning.ratios.length - 1))
  assert.equal(Sound.note(-3), Sound.note(0), "and it never goes below the root")

  Sound.setTuning(null)
  assert.equal(Sound.note(0) > 0, true, "rubbish is refused rather than breaking the sound")
  Sound.setTuning(before)
})
