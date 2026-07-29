// The game as the 32blit version played it: six by six, five colours, pairs count,
// and it refills until nothing matches.

export const CLASSIC = {
  id: "classic",
  name: "Classic",
  blurb: "Six by six, playing until nothing matches",
  cols: 6,
  rows: 6,
  minChain: 2,
  colours: 5,
  refill: true,
  timeLimit: 0,
  specialChance: 0,
  // The tuning the game has always had: five notes that cannot clash, so a chain of
  // any length walks up something deliberate.
  tuning: { root: "D4", scale: "minorPentatonic" },
}
