// A board that deals against itself.
//
// Every refilled dot takes a colour that does not match anything already beside
// it, so matches are never handed to you: what is left is whatever the collapse
// happens to line up, and finding it is the game. That alone would deal a dead
// board sooner or later, so once it has settled the board is checked, and if
// nothing matches a run is recoloured into it - the shortest legal one, somewhere
// in the middle where it is hardest to spot.
//
// So it cannot end, and it is never obvious. A chain longer than three here is
// worth more than a lucky cascade anywhere else.

// Colours already touching this cell. Refill deals bottom-up, so what is below and
// beside a cell is known even though what is above it is not yet dealt.
function neighbourColours(board, col, row) {
  const taken = new Set()
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    const colour = board.colourAt(col + dx, row + dy)
    if (colour >= 0) {
      taken.add(colour)
    }
  }
  return taken
}

export const ENDLESS = {
  id: "endless",
  name: "Endless",
  blurb: "Matches are hidden, never absent",
  cols: 7,
  rows: 7,
  minChain: 2,
  colours: 5,
  refill: true,
  timeLimit: 0,
  specialChance: 0,
  // A different root and a different scale every session. A mode with no end to it
  // should not sound the same every time it is sat down with, and it is the one place
  // a random tuning cannot clash with anything: there is no fixed sound to break.
  tuning: "random",

  pickColour(board, col, row) {
    const taken = neighbourColours(board, col, row)
    const free = []
    for (let colour = 0; colour < board.colours; colour++) {
      if (!taken.has(colour)) {
        free.push(colour)
      }
    }
    // Every colour touching the cell is a corner case on a board dealt from few
    // colours; then it takes whatever it can and the check below picks up the slack.
    const pool = free.length > 0 ? free : [...Array(board.colours).keys()]
    return pool[Math.floor(board.random() * pool.length)]
  },

  onSettled(board) {
    return board.ensureMove()
  },
}
