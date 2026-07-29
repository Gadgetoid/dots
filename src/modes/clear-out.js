// One board, no refill: take everything off it.
//
// The mode the original browser game called puzzle. Nothing is replaced, so every
// chain is spent forever and the order they are taken in is the whole game: leave a
// colour stranded and the board is over with dots still on it.

export const CLEAR_OUT = {
  id: "clearout",
  name: "CLEAR OUT",
  blurb: "ONE BOARD, NO REFILL. EMPTY IT",
  cols: 6,
  rows: 7,
  minChain: 2,
  colours: 4,
  refill: false,
  timeLimit: 0,
  specialChance: 0,
  // Hirajoshi, which is still rather than cheerful - the right sound for a board that
  // only ever gets emptier.
  tuning: { root: "F3", scale: "hirajoshi" },
}
