// A bigger board where a pair is worth nothing: three dots is the shortest chain
// that can be spent. Two dots of a colour sitting next to each other is therefore
// not a move, which is what makes a board of this size run out.

export const LONG_GAME = {
  id: "long",
  name: "LONG GAME",
  blurb: "EIGHT BY EIGHT. THREE DOTS OR MORE",
  cols: 8,
  rows: 8,
  minChain: 3,
  colours: 5,
  refill: true,
  timeLimit: 0,
  specialChance: 0,
}
