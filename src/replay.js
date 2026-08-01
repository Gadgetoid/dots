// A round written down as the chains that made it, so a score can be handed over with its
// working and checked by whoever receives it.
//
// There is no server here and no key that could be kept. Anything shipped in the bundle can
// be read by anyone who opens the page, so a signature over a score would be a signature
// anybody can forge, and a link carrying only "I scored 40,000" says nothing at all. What
// cannot be forged is a game: a seeded board and every colour dealt into it come from one
// number, so a list of chains played against that number replays to exactly one score.
// Claiming 40,000 means handing over thirty chains that really do make 40,000, and checking
// the claim is playing them.
//
// Everything here is the board's own rules, run without a frame of animation: the logical
// board is never mid-fall, so replaying is remove, collapse, refill, over and over. A chain
// that is not a chain - a colour that does not match, a cell that is not beside the last one,
// a dot that is not there - is refused, so a doctored run reads as no run rather than as a
// different score.
//
// The wire form is a bitstream written as base64url, per chain:
//
//   length, then its first cell, then two bits a step for the rest
//
// A cell is col + row * cols and a step is one of the four cardinals. Six by six needs six
// bits for either, so thirty chains of four dots is 510 bits: 86 characters, which is a link
// that survives being pasted anywhere.

import { Board } from "./board.js"
import { CONFIG } from "./config.js"
import { mulberry32 } from "./math.js"
import { modeRefills } from "./modes/index.js"

// The steps a chain can take between two dots, in the order their two bits number them.
const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

// base64url: the URL-safe alphabet, so a run needs no escaping in a query string.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

// How many bits it takes to write every value below `count`.
const bitsFor = (count) => Math.max(1, 32 - Math.clz32(Math.max(1, count - 1)))

// What a board of this shape costs per chain. Both are derived rather than fixed, so the
// format follows the board instead of assuming the one seeded mode's.
const widths = (cols, rows) => ({
  cell: bitsFor(cols * rows),
  // A chain may be every dot on the board, so the length needs one more value than the cells.
  length: bitsFor(cols * rows + 1),
})

class BitWriter {
  constructor() {
    this.bits = []
  }

  write(value, width) {
    for (let bit = width - 1; bit >= 0; bit--) {
      this.bits.push((value >> bit) & 1)
    }
  }

  // Padded up to a whole character with zeroes, which read back as a partial chain and are
  // stopped at by the reader; see BitReader.left.
  toString() {
    let text = ""
    for (let at = 0; at < this.bits.length; at += 6) {
      let value = 0
      for (let bit = 0; bit < 6; bit++) {
        value = (value << 1) | (this.bits[at + bit] || 0)
      }
      text += ALPHABET[value]
    }
    return text
  }
}

class BitReader {
  constructor(text) {
    this.bits = []
    for (const character of text) {
      const value = ALPHABET.indexOf(character)
      if (value < 0) {
        this.bad = true
        return
      }
      for (let bit = 5; bit >= 0; bit--) {
        this.bits.push((value >> bit) & 1)
      }
    }
    this.at = 0
    this.bad = false
  }

  get left() {
    return this.bits.length - this.at
  }

  read(width) {
    let value = 0
    for (let bit = 0; bit < width; bit++) {
      value = (value << 1) | this.bits[this.at + bit]
    }
    this.at += width
    return value
  }
}

// The chains of a round as a string. Cells as { col, row }, in the order they were linked.
export function packRun(moves, cols, rows) {
  const width = widths(cols, rows)
  const writer = new BitWriter()
  for (const chain of moves) {
    writer.write(chain.length, width.length)
    writer.write(chain[0].col + chain[0].row * cols, width.cell)
    for (let at = 1; at < chain.length; at++) {
      const step = STEPS.findIndex(
        ([dx, dy]) =>
          chain[at - 1].col + dx === chain[at].col && chain[at - 1].row + dy === chain[at].row,
      )
      // A chain that does not run through neighbours is not one the game could have made.
      if (step < 0) {
        return null
      }
      writer.write(step, 2)
    }
  }
  return writer.toString()
}

// And back, or null where the text is not a run of chains on a board this shape. Only the
// shape is checked here; whether the chains are legal is the replay's business.
export function unpackRun(text, cols, rows) {
  if (typeof text !== "string" || text === "") {
    return null
  }
  const width = widths(cols, rows)
  const reader = new BitReader(text)
  if (reader.bad) {
    return null
  }
  const moves = []
  // A chain needs its length and its first cell before it can be read at all, and what is
  // left at the end is the padding the last character was rounded up with.
  while (reader.left >= width.length + width.cell) {
    const length = reader.read(width.length)
    if (length === 0) {
      break
    }
    if (length > cols * rows) {
      return null
    }
    const cell = reader.read(width.cell)
    if (cell >= cols * rows) {
      return null
    }
    if (reader.left < (length - 1) * 2) {
      return null
    }
    const chain = [{ col: cell % cols, row: Math.floor(cell / cols) }]
    for (let at = 1; at < length; at++) {
      const [dx, dy] = STEPS[reader.read(2)]
      const last = chain[at - 1]
      chain.push({ col: last.col + dx, row: last.row + dy })
    }
    moves.push(chain)
  }
  return moves.length > 0 ? moves : null
}

// Play a run against the board its seed deals, and report what it really scored. Null where
// it is not a game that could have been played: an illegal chain, or more turns than the
// mode allows.
//
// Every rule here is the one the game plays by, and it has to stay that way - the score this
// returns and the score the player made are the same arithmetic done twice, and a link is
// worth nothing if the two can disagree. See test/replay.test.js, which plays a real game and
// checks its own run back.
export function replayRun(mode, seed, moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return null
  }
  if (mode.turnLimit > 0 && moves.length > mode.turnLimit) {
    return null
  }
  const board = new Board({
    cols: mode.cols,
    rows: mode.rows,
    minChain: mode.minChain,
    colours: mode.colours,
    specialChance: mode.specialChance,
    random: mulberry32(seed),
  })
  board.fill()

  let score = 0
  let multiplier = 1
  for (const cells of moves) {
    if (cells.length < mode.minChain) {
      return null
    }
    const chain = []
    for (const cell of cells) {
      const dot = board.at(cell.col, cell.row)
      if (!dot || chain.includes(dot)) {
        return null
      }
      const previous = chain[chain.length - 1]
      if (previous && (dot.colour !== previous.colour || !Board.adjacent(dot, previous))) {
        return null
      }
      chain.push(dot)
    }
    score += CONFIG.chainScore(chain.length) * multiplier
    multiplier =
      chain.length >= CONFIG.MULTIPLIER_CHAIN ? Math.min(multiplier + 1, CONFIG.MULTIPLIER_MAX) : 1
    board.remove(chain)
    board.collapse()
    if (modeRefills(mode, board)) {
      board.refill()
    }
  }
  return { score, turns: moves.length }
}
