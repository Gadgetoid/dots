// Ninety seconds, which is how long the original browser game gave you. The board
// still refills and can still run dry, so the clock is a second way to lose rather
// than the only one.

export const RUSH = {
  id: "rush",
  name: "RUSH",
  blurb: "NINETY SECONDS. SCORE WHAT YOU CAN",
  cols: 6,
  rows: 6,
  minChain: 2,
  colours: 5,
  refill: true,
  timeLimit: 90,
  specialChance: 0,
  // Blues, for the one mode with a clock on it: the flat fifth in the middle of the
  // run is what a hurried chain leans on.
  tuning: { root: "C4", scale: "blues" },
}
