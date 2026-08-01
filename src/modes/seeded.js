// Classic's board dealt from a number instead of from nothing, so two players holding the
// same code play the same dots in the same order and the only thing between them is the
// score. The 32blit game had this and showed its seed on screen; see seed.js for how a
// seed is written here.
//
// No clock, so a score says what was found in the board and nothing about how fast anyone
// can press. A limit on turns instead, which is the same length of round for everybody: two
// players holding up a score have spent the same board and the same thirty chains on it, so
// the only thing between them is which chains they took.
//
// Thirty is long enough to recover a bad opening and to build the multiplier back up twice,
// and short enough that a round is one sitting - and that the moves of one fit in a link:
// see replay.js.

export const SEEDED = {
  id: "seeded",
  name: "Seeded",
  blurb: "The same board and thirty turns for everyone",
  cols: 6,
  rows: 6,
  minChain: 2,
  colours: 5,
  refill: true,
  timeLimit: 0,
  turnLimit: 30,
  // Has to stay nought. A powerup costs a roll of the same generator the colours come from,
  // so dealing one would shift every colour after it and every code would give a different
  // board from the one it gave before, taking the stored scores with it.
  specialChance: 0,
  tuning: { root: "E3", scale: "kumoi" },
  seeded: true,
}
