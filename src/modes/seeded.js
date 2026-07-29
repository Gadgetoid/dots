// Classic's board dealt from a number instead of from nothing, so two players holding the
// same code play the same dots in the same order and the only thing between them is the
// score. The 32blit game had this and showed its seed on screen; see seed.js for how a
// seed is written here.
//
// No clock, so a score says what was found in the board and nothing about how fast anyone
// can press.

export const SEEDED = {
  id: "seeded",
  name: "Seeded",
  blurb: "The same board for everyone with the code",
  cols: 6,
  rows: 6,
  minChain: 2,
  colours: 5,
  refill: true,
  timeLimit: 0,
  // Has to stay nought. A powerup costs a roll of the same generator the colours come from,
  // so dealing one would shift every colour after it and every code would give a different
  // board from the one it gave before, taking the stored scores with it.
  specialChance: 0,
  tuning: { root: "E3", scale: "kumoi" },
  seeded: true,
}
