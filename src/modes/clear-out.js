// One random board, no refill: take as much off it as you can.
//
// Emptying it is the rare case, not the goal. A random board usually cannot be emptied
// at all - at sizes small enough to search exhaustively, only about one dealt board in
// ten can be, and the rest strand a colour whatever order the chains are taken in. So
// what this mode asks for is how far a board can be whittled down, and clearing one
// outright is a thing that happens occasionally and is worth a mention when it does.
//
// The designed boards, which are all clearable and known to be, are the puzzle mode.

export const CLEAR_OUT = {
  id: "clearout",
  name: "Clear out",
  blurb: "One random board, no refill. Whittle it down",
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
