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
  name: "Elimination",
  blurb: "A colour cleared off the board never returns",
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

  pickColour(board, col, row, phase) {
    const everything = () => board.colours && [...Array(board.colours).keys()]
    // Only a refill obeys what is left in play. The opening deal cannot: the board is
    // empty when it starts, so the first dot would set the only surviving colour and
    // every dot after it would see that one colour surviving - a board of 36 dots, all
    // the same. The original game had it the same way round, obeying counts in its
    // refill and not in its first deal.
    let pool = everything()
    if (phase === "refill") {
      const counts = board.colourCounts()
      const surviving = []
      for (let colour = 0; colour < counts.length; colour++) {
        if (counts[colour] > 0) {
          surviving.push(colour)
        }
      }
      if (surviving.length > 0) {
        pool = surviving
      }
    }
    return pool[Math.floor(board.random() * pool.length)]
  },
}
