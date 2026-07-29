// The seed codec: a number and the six dots that spell it are the same thing written two
// ways, and a code copied out of a message either means one board or nothing at all.

import test from "node:test"
import assert from "node:assert/strict"

import {
  SEED_DOTS,
  SEED_COLOURS,
  SEED_COUNT,
  coloursFromSeed,
  seedFromColours,
  seedCode,
  seedFromCode,
  randomSeed,
  dailySeed,
  validSeed,
} from "../src/seed.js"
import { mulberry32 } from "../src/math.js"

test("a code and the seed it spells are the same thing written two ways", () => {
  // Every one of them, since there are few enough to say so rather than sample it.
  for (let seed = 0; seed < SEED_COUNT; seed++) {
    const code = seedCode(seed)
    assert.equal(code.length, SEED_DOTS, `${seed} is six characters`)
    assert.equal(seedFromCode(code), seed, `${code} reads back as ${seed}`)
    assert.equal(seedFromColours(coloursFromSeed(seed)), seed)
  }
})

test("a code is written in the digits a level layout is written in", () => {
  // A colour is its index plus one, so nothing reads as an empty cell and no code has a
  // leading zero to lose.
  assert.equal(seedCode(0), "111111")
  assert.equal(seedCode(SEED_COUNT - 1), "555555")
  assert.deepEqual(coloursFromSeed(0), [0, 0, 0, 0, 0, 0])
  assert.deepEqual(coloursFromSeed(SEED_COUNT - 1), [4, 4, 4, 4, 4, 4])
  // The leftmost dot is the most significant, so a code reads the way it is written.
  assert.equal(seedCode(1), "111112")
})

test("anything that is not a code is not read as one", () => {
  for (const bad of ["", "1", "1111111", "011111", "111116", "11111a", "1111 1", " 111111"]) {
    assert.equal(seedFromCode(bad), null, `${JSON.stringify(bad)} is not a code`)
  }
  for (const bad of [null, undefined, 314522, ["1", "1"]]) {
    assert.equal(seedFromCode(bad), null, `${bad} is not a code`)
  }
})

test("validSeed takes only a seed a board can be dealt from", () => {
  assert.equal(validSeed(0), true)
  assert.equal(validSeed(SEED_COUNT - 1), true)
  assert.equal(validSeed(SEED_COUNT), false)
  assert.equal(validSeed(-1), false)
  assert.equal(validSeed(1.5), false)
  assert.equal(validSeed(null), false)
  assert.equal(validSeed("111111"), false)
})

test("a random code is always one the game can deal from", () => {
  const random = mulberry32(9)
  for (let i = 0; i < 500; i++) {
    const seed = randomSeed(random)
    assert.equal(validSeed(seed), true)
    assert.equal(seedFromCode(seedCode(seed)), seed)
  }
  // Both ends are reachable: the top of the range is not cut off by the floor.
  assert.equal(validSeed(randomSeed(() => 0)), true)
  assert.equal(
    randomSeed(() => 0.999999),
    SEED_COUNT - 1,
  )
})

test("the seed of the day is the same all day and different tomorrow", () => {
  const day = 86400000
  const midnight = 20000 * day
  assert.equal(dailySeed(midnight), dailySeed(midnight + day - 1), "one board all day")
  assert.notEqual(dailySeed(midnight), dailySeed(midnight + day), "and another tomorrow")
  // Counted in UTC days, so two players in different places quoting today's code mean the
  // same board.
  assert.equal(dailySeed(midnight), 20000 % SEED_COUNT)
  for (let offset = 0; offset < 40; offset++) {
    assert.equal(validSeed(dailySeed(midnight + offset * day)), true)
  }
})

test("the dots a code spells are the dots the picker shows", () => {
  const colours = coloursFromSeed(seedFromCode("314522"))
  assert.deepEqual(
    colours.map((colour) => colour + 1),
    [3, 1, 4, 5, 2, 2],
  )
  assert.ok(
    colours.every((colour) => colour >= 0 && colour < SEED_COLOURS),
    "every dot is a colour the board has",
  )
})
