// A seed, as six dots.
//
// The seeded mode deals its board from a number, and this is how a player reads, enters
// and passes on that number: six dots in the game's own colours, base five, the leftmost
// dot most significant. 15,625 boards.
//
// Written down it is six digits 1 to 5, the same way a level's layout is written in
// levels.js: a colour is its index plus one, so there is no nought to mistake for an empty
// cell and every code is exactly six characters, with no leading zero to lose.

export const SEED_DOTS = 6
export const SEED_COLOURS = 5
export const SEED_COUNT = SEED_COLOURS ** SEED_DOTS

// A day in milliseconds, for the seed of the day.
const DAY = 86400000

export const validSeed = (seed) => Number.isInteger(seed) && seed >= 0 && seed < SEED_COUNT

// The colours a seed spells, always SEED_DOTS of them, most significant first.
export function coloursFromSeed(seed) {
  const colours = new Array(SEED_DOTS)
  let left = seed
  for (let dot = SEED_DOTS - 1; dot >= 0; dot--) {
    colours[dot] = left % SEED_COLOURS
    left = Math.floor(left / SEED_COLOURS)
  }
  return colours
}

export function seedFromColours(colours) {
  let seed = 0
  for (const colour of colours) {
    seed = seed * SEED_COLOURS + colour
  }
  return seed
}

export const seedCode = (seed) =>
  coloursFromSeed(seed)
    .map((colour) => colour + 1)
    .join("")

// A seed from what someone typed or pasted, or null if it is not one. Strict: a code is
// worth nothing if it silently turns into a different board from the one it was copied off.
export function seedFromCode(code) {
  if (typeof code !== "string" || code.length !== SEED_DOTS) {
    return null
  }
  const colours = []
  for (const character of code) {
    const digit = Number(character)
    if (!Number.isInteger(digit) || digit < 1 || digit > SEED_COLOURS) {
      return null
    }
    colours.push(digit - 1)
  }
  return seedFromColours(colours)
}

export const randomSeed = (random = Math.random) => Math.floor(random() * SEED_COUNT)

// The board everyone gets today. Counted in whole UTC days, so a code quoted between two
// players means the same board whatever either of their clocks says locally.
//
// The day number is used as the seed directly: neighbouring seeds give unrelated boards,
// because mulberry32 mixes the seed before it yields anything, so there is nothing for a
// hashing step to improve on.
export const dailySeed = (now = Date.now()) => Math.floor(now / DAY) % SEED_COUNT
