// The link grammar, which is pure: a query string in, an intent out. A link that names
// something the game cannot honour has to come back as nothing at all, since a link that
// quietly opens a different board from the one it names is worse than one that fails.

import test from "node:test"
import assert from "node:assert/strict"

import { parseLink, levelFromToken, levelSlug, linkParams, LINK_KEYS } from "../src/link.js"
import { LEVELS } from "../src/modes/levels.js"
import { GAME_MODES, modeById } from "../src/modes/index.js"
import { seedFromCode, seedCode, dailySeed } from "../src/seed.js"

const IDS = GAME_MODES.map((mode) => mode.id)

test("a link names a mode, outright or by implication", () => {
  assert.deepEqual(parseLink("?mode=rush", IDS), { mode: "rush", seed: "today", puzzle: null })
  // ?seed and ?puzzle say which mode by being the thing they are.
  assert.equal(parseLink("?seed", IDS).mode, "seeded")
  assert.equal(parseLink("?puzzle=3", IDS).mode, "puzzle")
  // An explicit mode wins, being the least ambiguous thing a link can say.
  assert.equal(parseLink("?mode=rush&seed=314522", IDS).mode, "rush")
})

test("a valueless seed is today's board and a code is that board", () => {
  assert.equal(parseLink("?seed", IDS).seed, "today")
  // Also with the equals a browser leaves behind, which means the same thing.
  assert.equal(parseLink("?seed=", IDS).seed, "today")
  assert.equal(parseLink("?seed=314522", IDS).seed, seedFromCode("314522"))
})

test("a link that cannot be honoured comes back as nothing", () => {
  for (const bad of [
    "",
    "?",
    "?utm=elsewhere",
    "?mode=nosuch",
    "?mode=",
    "?seed=99999",
    "?seed=314529",
    "?seed=abcdef",
  ]) {
    assert.equal(parseLink(bad, IDS), null, `${JSON.stringify(bad)} asks for nothing`)
  }
  assert.equal(parseLink(undefined, IDS), null)
  // And with no modes to name, nothing can be named.
  assert.equal(parseLink("?mode=rush", []), null)
})

test("a level is named by number counted from one, or by name", () => {
  assert.equal(levelFromToken(LEVELS, "1"), 0)
  assert.equal(levelFromToken(LEVELS, "9"), 8)
  assert.equal(levelFromToken(LEVELS, String(LEVELS.length)), LEVELS.length - 1)
  // The name as written, as slugged, and as a browser hands it over decoded.
  const named = LEVELS[6].name
  assert.equal(levelFromToken(LEVELS, named), 6)
  assert.equal(levelFromToken(LEVELS, levelSlug(named)), 6)
  assert.equal(levelFromToken(LEVELS, named.toUpperCase()), 6)
})

test("a token naming no level is refused rather than rounded to one", () => {
  for (const bad of ["", "0", "999", String(LEVELS.length + 1), "nosuchlevel", "-1", "1.5"]) {
    assert.equal(levelFromToken(LEVELS, bad), null, `${JSON.stringify(bad)} names no level`)
  }
})

test("every level name is its own link", () => {
  // A duplicate name would make one of the two unreachable by name, and silently: the first
  // of them would answer for both.
  const slugs = LEVELS.map((level) => levelSlug(level.name))
  assert.equal(new Set(slugs).size, slugs.length, "no two levels slug the same")
  for (const [index, slug] of slugs.entries()) {
    assert.ok(slug.length > 0, `level ${index + 1} has something to be called`)
    // Nothing that would be read as an index instead of a name.
    assert.ok(!/^\d+$/.test(slug), `level ${index + 1} does not slug to a number`)
  }
})

test("what is being played writes itself back into a link", () => {
  const seeded = modeById("seeded")
  const today = dailySeed()
  // Today's board writes the key with no value: pinning the code would deal yesterday's
  // board on a reload tomorrow.
  assert.deepEqual(
    linkParams({ mode: seeded, playing: true, code: seedCode(today), today: true }),
    [["seed", null]],
  )
  assert.deepEqual(
    linkParams({ mode: seeded, playing: true, code: "314522", today: false }),
    [["seed", "314522"]],
    "and any other board writes its code",
  )

  const puzzle = modeById("puzzle")
  assert.deepEqual(linkParams({ mode: puzzle, playing: true, level: 8, levels: LEVELS }), [
    ["puzzle", levelSlug(LEVELS[8].name)],
  ])
  assert.deepEqual(linkParams({ mode: modeById("rush"), playing: true }), [["mode", "rush"]])
  // Nothing is being played, so there is nothing to say and a stale link is cleared.
  assert.deepEqual(linkParams({ mode: seeded, playing: false, code: "314522" }), [])
  assert.deepEqual(linkParams({}), [])
})

test("a link written is a link that reads back the same", () => {
  const cases = [
    { mode: modeById("seeded"), playing: true, code: "314522", today: false },
    { mode: modeById("seeded"), playing: true, code: seedCode(dailySeed()), today: true },
    { mode: modeById("puzzle"), playing: true, level: 12, levels: LEVELS },
    { mode: modeById("rush"), playing: true },
  ]
  for (const state of cases) {
    const query = linkParams(state)
      .map(([key, value]) => (value === null ? key : `${key}=${value}`))
      .join("&")
    const read = parseLink(`?${query}`, IDS)
    assert.ok(read, `${query} reads back`)
    assert.equal(read.mode, state.mode.id, `${query} names its mode`)
    if (state.mode.levels) {
      assert.equal(levelFromToken(LEVELS, read.puzzle), state.level, `${query} names its level`)
    }
    if (state.mode.seeded) {
      assert.equal(read.seed, state.today ? "today" : seedFromCode(state.code))
    }
  }
})

test("the keys the grammar owns are the ones it writes", () => {
  // syncLink clears these and nothing else, so anything the page was opened with survives.
  const written = new Set()
  for (const state of [
    { mode: modeById("seeded"), playing: true, code: "314522", today: false },
    { mode: modeById("puzzle"), playing: true, level: 0, levels: LEVELS },
    { mode: modeById("classic"), playing: true },
  ]) {
    for (const [key] of linkParams(state)) {
      written.add(key)
    }
  }
  for (const key of written) {
    assert.ok(LINK_KEYS.includes(key), `${key} is declared`)
  }
})
