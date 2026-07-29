// The board's rules, which is everything the game is judged by. None of this
// needs a browser: a dot's colour is an index and nothing here draws.

import test from "node:test"
import assert from "node:assert/strict"

import { Board, Dot } from "../src/board.js"
import { mulberry32 } from "../src/math.js"

// A board dealt from a written-out grid, so a test says what it means. Each string
// is a row and each character a colour index; a dot is a digit.
function boardFrom(rows, options = {}) {
  const board = new Board({
    cols: rows[0].length,
    rows: rows.length,
    random: mulberry32(1),
    ...options,
  })
  rows.forEach((row, y) => {
    ;[...row].forEach((char, x) => {
      if (char === ".") {
        return
      }
      const dot = new Dot(x, y, Number(char))
      dot.y = y
      board.put(x, y, dot)
      board.dots.push(dot)
    })
  })
  return board
}

test("a chain runs through cardinal neighbours of one colour", () => {
  // The dot below is a different colour and the one diagonally down is the same,
  // so each rule is tested on its own.
  const board = boardFrom(["00", "10"])
  const start = board.at(0, 0)
  const right = board.at(1, 0)
  const down = board.at(0, 1)
  const diagonal = board.at(1, 1)

  assert.equal(board.linkAction([start], right), "extend")
  assert.equal(board.linkAction([start], down), null, "a different colour cannot be linked")
  assert.equal(board.linkAction([start], diagonal), null, "a diagonal is never adjacent")
})

test("stepping back onto the previous dot retracts", () => {
  const board = boardFrom(["000"])
  const chain = [board.at(0, 0), board.at(1, 0)]
  assert.equal(board.linkAction(chain, board.at(0, 0)), "retract")
  assert.equal(board.linkAction(chain, board.at(2, 0)), "extend")
  chain.push(board.at(2, 0))
  assert.equal(board.linkAction(chain, board.at(0, 0)), null, "no jumping back down the chain")
})

test("a dot another player is holding cannot be linked", () => {
  const board = boardFrom(["00"])
  const held = board.at(1, 0)
  held.claim = 1
  assert.equal(board.linkAction([board.at(0, 0)], held, 0), null)
  assert.equal(board.linkAction([board.at(0, 0)], held, 1), "extend")
})

test("a move is a chain as long as the mode demands", () => {
  const pair = boardFrom(["001", "121", "012"], { minChain: 2 })
  assert.equal(
    pair.moveAvailable(),
    true,
    "two neighbours of a colour is a move where two is enough",
  )

  const needsThree = boardFrom(["001", "121", "012"], { minChain: 3 })
  assert.equal(needsThree.moveAvailable(), false, "a pair is not a move where three are needed")

  const hasThree = boardFrom(["000", "121", "012"], { minChain: 3 })
  assert.equal(hasThree.moveAvailable(), true)
})

test("hasChain finds a run that turns a corner", () => {
  // The twos make an L exactly four long: down one column and along a row. No
  // other colour on this board runs longer than three.
  const board = boardFrom(["0101", "0201", "0222", "1010"], { minChain: 4 })
  assert.equal(board.hasChain(4), true)
  assert.equal(board.hasChain(5), false)
})

test("collapse drops the survivors and leaves the top empty", () => {
  const board = boardFrom(["01", "01", "01"])
  board.remove([board.at(0, 1)])
  board.collapse()

  assert.equal(board.at(0, 0), null, "the column is one shorter")
  assert.equal(board.at(0, 1).colour, 0)
  assert.equal(board.at(0, 2).colour, 0)
  assert.equal(board.at(1, 0).colour, 1, "the other column is untouched")
})

test("a collapsed dot falls to where it now belongs", () => {
  const board = boardFrom(["0", "0", "0"])
  const top = board.at(0, 0)
  board.remove([board.at(0, 2)])
  board.collapse()

  assert.equal(top.row, 1, "its target row moved")
  assert.equal(top.y, 0, "but it has not got there yet")
  for (let i = 0; i < 200; i++) {
    board.step(1 / 60)
  }
  assert.equal(top.settled, true)
  assert.equal(top.y, 1)
})

test("refill tops up every column", () => {
  const board = new Board({ cols: 3, rows: 3, random: mulberry32(7) })
  board.fill()
  board.remove([board.at(0, 0), board.at(0, 1), board.at(2, 2)])
  board.collapse()
  board.refill()

  assert.equal(board.count, 9)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      assert.ok(board.at(col, row), `${col},${row} is filled`)
    }
  }
  // What was dealt in starts above the board and falls.
  assert.ok(board.dots.some((dot) => dot.y < 0))
})

test("ensureMove only acts on a dead board, and makes exactly one move", () => {
  const alive = boardFrom(["001", "121", "012"], { minChain: 2 })
  assert.equal(alive.ensureMove(), null, "a board with a move is left alone")

  // A checkerboard of two colours has no two neighbours alike.
  const dead = boardFrom(["0101", "1010", "0101", "1010"], { minChain: 2 })
  assert.equal(dead.moveAvailable(), false)
  const changed = dead.ensureMove()
  assert.ok(changed && changed.length > 0)
  assert.equal(dead.moveAvailable(), true, "and now there is one")
})

test("ensureMove makes a run as long as the mode needs", () => {
  const dead = boardFrom(["0101", "1010", "0101", "1010"], { minChain: 3 })
  dead.ensureMove()
  assert.equal(dead.hasChain(3), true)
})

test("nudging a column swaps it with its neighbour and wraps", () => {
  const board = boardFrom(["012", "012"])
  assert.equal(board.nudgeColumn(0, 1), true)
  assert.equal(board.colourAt(0, 0), 1)
  assert.equal(board.colourAt(1, 0), 0)

  assert.equal(board.nudgeColumn(2, 1), true, "the last column wraps to the first")
  assert.equal(board.colourAt(0, 0), 2)
})

test("a landing squashes the dot and rings out", () => {
  const board = boardFrom(["0"], { rows: 2 })
  const dot = board.at(0, 0)
  dot.row = 1
  dot.y = -3
  let landed = 0
  for (let i = 0; i < 60; i++) {
    board.step(1 / 60, (_dot, speed) => {
      landed = Math.max(landed, speed)
    })
  }
  assert.ok(landed > 0, "it landed")
  assert.ok(Math.abs(dot.wobble.value) > 0 || Math.abs(dot.wobble.velocity) > 0, "and it wobbled")

  for (let i = 0; i < 600; i++) {
    board.step(1 / 60)
  }
  assert.ok(Math.abs(dot.wobbleAmount) < 0.001, "the wobble settles")
  assert.equal(dot.settled, true)
})
