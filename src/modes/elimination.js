// A war of attrition. The board refills, but only ever with colours that are still
// on it: clear the last dot of a colour and it never comes back.
//
// So the pool of colours shrinks as the game goes on, the board gets easier to match
// and harder to survive - two colours left can still deal a checkerboard - and the
// way to win is to take the last colour off the board entirely. The original browser
// game called this elimination, and it worked exactly this way: its refill asked for
// a colour "obeying counts", meaning one with pieces left in play.

export const ELIMINATION = {
  id: "elimination",
  name: "ELIMINATION",
  blurb: "A CLEARED COLOUR NEVER COMES BACK",
  cols: 6,
  rows: 6,
  minChain: 2,
  colours: 5,
  // A board with nothing on it is cleared, and a refill would deal from a pool that
  // no longer holds anything: this is the one mode that stops dealing.
  refill: (board) => !board.empty,
  timeLimit: 0,
  specialChance: 0,
  // Insen, which has a flat second straight off the root and is the darkest thing in
  // the list. A mode about grinding colours out of existence has earned it.
  tuning: { root: "G3", scale: "insen" },

  pickColour(board) {
    const counts = board.colourCounts()
    const surviving = []
    for (let colour = 0; colour < counts.length; colour++) {
      if (counts[colour] > 0) {
        surviving.push(colour)
      }
    }
    // The opening deal has an empty board and therefore no survivors, so the first
    // board is dealt from everything and the pool only ever shrinks from there.
    const pool = surviving.length > 0 ? surviving : [...Array(board.colours).keys()]
    return pool[Math.floor(board.random() * pool.length)]
  },
}
