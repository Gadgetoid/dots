// A bigger board where a pair is worth nothing: three dots is the shortest chain
// that can be spent. Two dots of a colour sitting next to each other is therefore
// not a move, which is what makes a board of this size run out.

export const LONG_GAME = {
  id: "long",
  name: "Long game",
  blurb: "Eight by eight, and a pair is not a move",
  cols: 8,
  rows: 8,
  minChain: 3,
  colours: 5,
  refill: true,
  timeLimit: 0,
  specialChance: 0,
  // Hijaz. A mode about holding out for a longer chain wants a scale that sounds like
  // it is going somewhere, and the augmented second off the root does.
  tuning: { root: "A3", scale: "hijaz" },
}
