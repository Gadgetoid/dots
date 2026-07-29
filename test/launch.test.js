// What the game opens on, and the ordering that decides it.
//
// This is the one test file that stands storage up, because everything here depends on it.
// `load()` swallows its own failure (persistence.js), so under node with no indexedDB the
// restore path never executes at all and a test that only constructs a Game is testing a
// player who has never played. A fake store is what makes a returning player reachable, and
// what a level being unlocked is made of.

import test from "node:test"
import assert from "node:assert/strict"

// What storage answers with. Set per test, before a Game is built.
let stored = {}

globalThis.indexedDB = {
  open() {
    const request = {
      result: {
        transaction: () => ({
          objectStore: () => ({
            get(key) {
              const read = { result: stored[key] ?? null }
              // A microtask later, as a real store answers: the point of these tests is that
              // nothing may depend on it having answered already.
              queueMicrotask(() => read.onsuccess && read.onsuccess())
              return read
            },
            put(value, key) {
              stored[key] = value
            },
          }),
        }),
      },
    }
    queueMicrotask(() => request.onsuccess && request.onsuccess())
    return request
  },
}

const { Game, PHASE } = await import("../src/game.js")
const { seedCode, dailySeed, seedFromCode } = await import("../src/seed.js")
const { LEVELS } = await import("../src/modes/levels.js")
const { levelSlug } = await import("../src/link.js")

// A game opened with this link, once what was remembered is back.
async function opened(search = "", remembered = {}) {
  stored = { ...remembered }
  const game = new Game()
  await game.restored
  game.launch(search)
  return game
}

// A player who has played before. `settings.mode` is what they last played.
const returning = (mode, extra = {}) => ({ ...extra, settings: { mode, ...extra.settings } })

test("a player with nothing remembered lands in today's board, playing", () => {
  return opened().then((game) => {
    assert.equal(game.phase, PHASE.PLAYING, "in the game, not on a menu")
    assert.equal(game.page, null)
    assert.equal(game.mode.id, "seeded")
    assert.equal(game.seed, dailySeed(), "the board everyone else is on today")
    assert.ok(game.board.count > 0)
  })
})

test("and is told how to play, once", async () => {
  const fresh = await opened()
  assert.ok(fresh.banner, "the one thing the title screen would have said")
  assert.match(fresh.banner.text, /pop them/)

  const known = await opened("", returning("classic"))
  assert.equal(known.banner, null, "a player who has been here before is not told again")
})

test("a player carries on with the mode they last played", async () => {
  const game = await opened("", returning("rush"))
  assert.equal(game.mode.id, "rush")
  assert.equal(game.phase, PHASE.PLAYING)
  assert.ok(game.timeLeft > 0, "and the clock is running")
})

test("a returning seeded player gets today, not the code they left on", async () => {
  const stale = seedFromCode("555555")
  const game = await opened("", returning("seeded", { settings: { seed: stale } }))
  assert.equal(game.mode.id, "seeded")
  assert.equal(game.seed, dailySeed())
  assert.notEqual(game.seed, stale, "coming back is coming back to the daily board")
})

test("a returning puzzle player lands on the level they reached", async () => {
  // This is the assertion the whole re-ordering exists for. Applied at construction, before
  // storage has answered, progress is empty, every level past the first reads as locked and
  // start() clamps to level one.
  const game = await opened(
    "",
    returning("puzzle", { progress: { puzzle: { 0: 24, 1: 81, 2: 96 } } }),
  )
  assert.equal(game.mode.id, "puzzle")
  assert.equal(game.level, 3, "the furthest reached, not the first")
  assert.equal(game.phase, PHASE.PLAYING)
})

test("a link names the board, whatever was last played", async () => {
  const game = await opened("?seed=314522", returning("puzzle", { settings: { seed: 99 } }))
  assert.equal(game.mode.id, "seeded")
  assert.equal(game.seedText, "314522")
  assert.equal(game.phase, PHASE.PLAYING, "straight into it")
})

test("a shared code survives storage answering after the link", async () => {
  // The bug this ordering fixes: the link was read at construction and #restoreState, landing
  // a frame or two later, put the player's own last code back over the top of it.
  stored = { settings: { mode: "classic", seed: seedFromCode("555555") } }
  const game = new Game()
  await game.restored
  game.launch("?seed=314522")
  // And again after everything storage could possibly do has been done.
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(game.seedText, "314522", "the code that was shared is the code being played")
  assert.equal(game.mode.id, "seeded")
})

test("a link to a puzzle names it by number or by name, alike", async () => {
  const progress = { puzzle: {} }
  for (let index = 0; index < 12; index++) {
    progress.puzzle[index] = 100
  }
  const byNumber = await opened("?puzzle=9", returning("classic", { progress }))
  const byName = await opened(
    `?puzzle=${levelSlug(LEVELS[8].name)}`,
    returning("classic", { progress }),
  )
  assert.equal(byNumber.level, 8, "counted from one, as the HUD counts")
  assert.equal(byName.level, 8)
  assert.equal(byNumber.mode.id, "puzzle")
})

test("a link to a puzzle nobody has reached opens the picker and says why", async () => {
  const game = await opened("?puzzle=20", returning("classic"))
  assert.equal(game.page, "levels", "the picker, which draws padlocks and explains itself")
  assert.notEqual(game.phase, PHASE.PLAYING, "and nothing was started")
  assert.ok(game.notice, "with a line saying why this page is the page")
  assert.match(game.notice, new RegExp(LEVELS[19].name))
  // Said as well as drawn, and named before the page's own contents.
  assert.match(game.pageSpeech(), new RegExp(LEVELS[19].name))
  // Leaving the page drops it, so it cannot turn up again later unasked.
  game.menuBack()
  assert.equal(game.notice, null)
})

test("a link asking for something the game has not got falls back", async () => {
  for (const bad of [
    "?mode=nosuch",
    "?seed=abcdef",
    "?puzzle=nosuchlevel",
    "?puzzle=999",
    "?x=1",
  ]) {
    const game = await opened(bad, returning("rush"))
    assert.equal(game.mode.id, "rush", `${bad} left the player where they were`)
    assert.equal(game.phase, PHASE.PLAYING)
  }
})

test("the game opens once, however many times it is asked to", async () => {
  const game = await opened("?mode=rush")
  const board = game.board
  game.launch("?mode=classic")
  assert.equal(game.mode.id, "rush", "the second ask is ignored")
  assert.equal(game.board, board, "and nothing was re-dealt")
})

test("the address bar can bring a player back to the board they were on", async () => {
  // What the returning-seeded rule leans on: the code is not remembered in storage, it is in
  // the link, so a reload of that link is the same board and a bare reload is today's.
  const code = "241355"
  const game = await opened(`?seed=${code}`)
  assert.equal(game.seedText, code)
  const bare = await opened("", returning("seeded", { settings: { seed: seedFromCode(code) } }))
  assert.equal(seedCode(bare.seed), seedCode(dailySeed()))
})
