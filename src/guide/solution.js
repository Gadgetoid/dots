// A solution, played out on a board.
//
// The game's own board is not available to a page - it is a WebGL field driven by a game loop -
// so this replays a route through the elements board.js builds: the chain grows a dot at a time,
// the run unzips, and the columns fall in behind it. What the numbers do is the game's: the score
// is the cube of the chain's length times the multiplier in hand, and a chain of fewer than four
// puts that multiplier back to one.
//
// The whole of it is a position in a list of frames, two per move: the chain drawn and waiting,
// then the board after it has been spent. Every frame can be arrived at without animating, by
// rebuilding the board and applying the moves before it, which is what the step buttons do and
// what a reader who has asked for less movement gets.

import { CONFIG } from "../config.js"
import { levelGrid, PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { EMPTY } from "../solver.js"
import { createBoard, createDot, placeDot, linkDot, floatScore } from "./board.js"

// The pace of a replay, in milliseconds. A dot joins the chain about as fast as a player dragging
// across the board manages it, and everything else is long enough to be followed.
const LINK_STEP = 130
const BEFORE_POP = 280
const POP_LIFE = 340
const FALL = 300
const BETWEEN_MOVES = 420

export function createSolution(level, moves, { shapes = true, onState = () => {} } = {}) {
  const cols = PUZZLE_COLS
  const rows = PUZZLE_ROWS
  const board = createBoard(cols, rows, `The solution to ${level.name}, played out`)

  let dots = []
  let showing = shapes
  // Where the replay is: frame 2k is the board with k moves played, 2k+1 is the same board with
  // move k's chain drawn on it and not yet spent.
  let frame = 0
  let running = false
  // Bumped by anything that interrupts a replay, so a timer that belongs to an abandoned one
  // knows not to carry on.
  let generation = 0

  const dotAt = (col, row) => dots.find((dot) => dot.col === col && dot.row === row)

  const clearDots = () => {
    for (const dot of dots) {
      dot.group.remove()
    }
    dots = []
  }

  // The level as it is dealt: what the layout falls to, which is what the picker draws as its
  // preview and what the player is given.
  const deal = () => {
    clearDots()
    const grid = levelGrid(level)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const colour = grid[col + row * cols]
        if (colour === EMPTY) {
          continue
        }
        const dot = { ...createDot(colour, showing), col, row }
        placeDot(dot, col, row, false)
        board.dots.append(dot.group)
        dots.push(dot)
      }
    }
  }

  // Everything above a gap comes down over it, which is the whole of gravity here and the reason
  // the order of a level's chains is the level.
  const collapse = (animate) => {
    for (let col = 0; col < cols; col++) {
      const column = dots.filter((dot) => dot.col === col).sort((a, b) => a.row - b.row)
      let row = rows - 1
      for (let index = column.length - 1; index >= 0; index--) {
        column[index].row = row--
      }
      for (const dot of column) {
        placeDot(dot, dot.col, dot.row, animate)
      }
    }
  }

  const take = (cells) => {
    for (const cell of cells) {
      const dot = dotAt(cell.col, cell.row)
      if (dot) {
        dot.group.remove()
        dots = dots.filter((other) => other !== dot)
      }
    }
  }

  const state = () => {
    const played = Math.floor(frame / 2)
    return {
      move: played,
      frame,
      moves: moves.length,
      score: played > 0 ? moves[played - 1].running : 0,
      // What the next chain would be paid at, which is what a player has in hand.
      multiplier: moves[played]?.multiplier ?? 1,
      // Which move is on the board rather than behind it, for a list to follow along with.
      showing: frame % 2 === 1 ? played : null,
      running,
      finished: frame >= moves.length * 2,
    }
  }

  const report = () => onState(state())

  // Any frame, with nothing moving: the board dealt again and the moves before this one applied.
  const goTo = (wanted) => {
    generation++
    running = false
    frame = Math.max(0, Math.min(wanted, moves.length * 2))
    board.chain.hide()
    deal()
    const played = Math.floor(frame / 2)
    for (let index = 0; index < played; index++) {
      take(moves[index].cells)
      collapse(false)
    }
    if (frame % 2 === 1) {
      const move = moves[played]
      for (const cell of move.cells) {
        linkDot(dotAt(cell.col, cell.row), true)
      }
      board.chain.show(move.cells, move.colour)
    }
    report()
  }

  const wait = (ms, mine) =>
    new Promise((resolve) => {
      setTimeout(() => resolve(generation === mine), ms)
    })

  // One move, drawn the way it would be played: the chain reaching out a dot at a time, a pause
  // over it, then the run unzipping from the end it was started at.
  const playMove = async (index, mine) => {
    const move = moves[index]
    for (let count = 1; count <= move.cells.length; count++) {
      const linked = move.cells.slice(0, count)
      linkDot(dotAt(move.cells[count - 1].col, move.cells[count - 1].row), true)
      board.chain.show(linked, move.colour)
      if (!(await wait(LINK_STEP, mine))) {
        return false
      }
    }
    frame = index * 2 + 1
    report()
    if (!(await wait(BEFORE_POP, mine))) {
      return false
    }

    for (const [at, cell] of move.cells.entries()) {
      const dot = dotAt(cell.col, cell.row)
      dot.body.style.animationDelay = `${at * CONFIG.POP_STAGGER}s`
      dot.body.classList.add("popping")
    }
    floatScore(board, move.cells[Math.floor(move.cells.length / 2)], `+${move.scored}`, move.colour)
    board.chain.hide()
    if (!(await wait(POP_LIFE + move.cells.length * CONFIG.POP_STAGGER * 1000, mine))) {
      return false
    }

    take(move.cells)
    collapse(true)
    frame = index * 2 + 2
    report()
    return await wait(FALL + BETWEEN_MOVES, mine)
  }

  const play = async () => {
    if (running) {
      return
    }
    // Finished, or standing over a chain that has not been spent: either way the move it is in
    // the middle of is where a replay starts, and it starts at the top of it.
    let index = Math.floor(frame / 2)
    if (index >= moves.length) {
      index = 0
    }
    goTo(index * 2)
    const mine = ++generation
    running = true
    report()
    for (; index < moves.length; index++) {
      if (!(await playMove(index, mine))) {
        return
      }
    }
    running = false
    report()
  }

  const pause = () => {
    if (!running) {
      return
    }
    // Back to the last frame that is a whole state rather than the middle of an animation.
    goTo(frame)
  }

  deal()
  report()

  return {
    board,
    svg: board.svg,
    play,
    pause,
    toggle: () => (running ? pause() : play()),
    step: () => goTo(frame + 1),
    back: () => goTo(frame - 1),
    restart: () => goTo(0),
    state,
    // The colour shapes, on or off, as the game's own setting does it. The board is rebuilt at
    // the frame it was on, since a shape is the path a dot is drawn with.
    setShapes(on) {
      showing = on
      goTo(frame)
    },
  }
}
