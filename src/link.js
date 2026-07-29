// What a link asks the game to open, and how a game writes itself back into one.
//
// The grammar, all in the query string so it survives being deployed under a subpath and
// needs no server-side rewrite:
//
//   ?seed           the seeded mode on today's board
//   ?seed=314522    the seeded mode on that code
//   ?mode=<id>      that mode, from its own start
//   ?puzzle=9       the puzzle mode, level 9, counted from one as the HUD counts it
//   ?puzzle=comb    the puzzle mode, that level by name
//
// Nothing here knows about the game: parsing is a pure reading of the query, and a level
// token is resolved against a list of levels handed in. What a refused link then does is
// Game.launch's business.
//
// A link that names something this cannot honour is refused outright, never approximated. A
// link is worth nothing if it quietly opens a different board from the one it names.

import { seedFromCode } from "./seed.js"

// Every key the grammar owns, so writing a link can clear the ones it is not using and leave
// anything else in the query alone.
export const LINK_KEYS = ["mode", "seed", "puzzle"]

// Which mode a key asks for where the link names one only by implication.
const IMPLIED_MODE = [
  ["seed", "seeded"],
  ["puzzle", "puzzle"],
]

// A level's name as it appears in a link: lower case, and any run of characters that are not
// letters or digits becomes a hyphen. So "The gate" is "the-gate" and "Warm up" is "warm-up".
export const levelSlug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

// Which level a token means, or null if it means none of them. A number is an index counted
// from one, as the HUD and the picker count it; anything else is matched against the names by
// slug, so a link can be readable and stays readable when a level is inserted before it.
export function levelFromToken(levels, token) {
  if (typeof token !== "string" || token === "") {
    return null
  }
  if (/^\d+$/.test(token)) {
    const index = Number(token) - 1
    return index >= 0 && index < levels.length ? index : null
  }
  const wanted = levelSlug(token)
  const found = levels.findIndex((level) => levelSlug(level.name) === wanted)
  return found < 0 ? null : found
}

// What a query string is asking for, or null if it asks for nothing this understands.
//
// `modes` is the ids a link may name, so an unknown one is refused here instead of falling
// through to the game's default mode and opening something else.
//
// Returns { mode, seed, puzzle }. `seed` is a seed number, or "today" where the link asked
// for the seeded mode without naming a board. `puzzle` is the token still unresolved, since
// resolving it needs the levels.
export function parseLink(search, modes = []) {
  let params
  try {
    params = new URLSearchParams(search || "")
  } catch {
    return null
  }

  // An explicit mode wins where it disagrees with the rest: it is the least ambiguous thing
  // a link can say. One that names no mode this game has is refused.
  let mode = params.get("mode")
  if (mode !== null && !modes.includes(mode)) {
    return null
  }
  if (mode === null) {
    const implied = IMPLIED_MODE.find(([key, id]) => params.has(key) && modes.includes(id))
    mode = implied ? implied[1] : null
  }
  if (mode === null) {
    return null
  }

  // A valueless ?seed is today's board, which is what makes a shared link mean the board of
  // the day it is opened and not the day it was copied. A code that is not one is refused.
  let seed = "today"
  const code = params.get("seed")
  if (code) {
    seed = seedFromCode(code)
    if (seed === null) {
      return null
    }
  }

  return { mode, seed, puzzle: params.get("puzzle") }
}

// The params that would reproduce what is being played, as [key, value] pairs where a null
// value means a key with nothing after it. Empty while nothing is being played, which is what
// strips a stale link out of the address bar.
//
// Today's board writes a valueless ?seed rather than its code, for the reason above: pinning
// the code would deal yesterday's board on a reload tomorrow.
export function linkParams({ mode, playing, code, today, level, levels } = {}) {
  if (!mode || !playing) {
    return []
  }
  if (mode.seeded) {
    return [["seed", today ? null : code]]
  }
  if (mode.levels && levels && levels[level]) {
    return [["puzzle", levelSlug(levels[level].name)]]
  }
  return [["mode", mode.id]]
}
