// A solver for the puzzle levels: what proves a level can actually be emptied, and what
// the most it can score is.
//
// Shared by three callers, which is why it lives here rather than beside a test. The level
// test proves every shipped level is clearable and that its par is the number written down;
// tools/levels.mjs reports on a candidate while it is being authored; and the editor scores
// a board as it is drawn.
//
// It works on a plain array of colour codes rather than a Board, so it can search
// thousands of positions without allocating dots, and it applies the same two rules
// the game does: a chain is a simple path through cardinal neighbours of one colour,
// and every pop is followed by the columns collapsing.
//
// A move is identified by the set of cells it removes, not by the path that took
// them: many paths through a blob remove the same cells and lead to the same
// position, and collapsing them is what keeps the search small enough to finish. One
// path per set is kept in the order it was walked, so a solution can be handed back
// as chains a player could actually draw - which is what lets a test replay it
// through the real game and check that this model of a move matches the game's.
//
// The search is sound rather than complete. Finding a sequence proves a level is
// clearable; running out of budget proves nothing, so the test treats it as a
// failure and the level is redesigned.

export const EMPTY = -1

export function parse(layout, cols, rows) {
  const grid = new Int8Array(cols * rows).fill(EMPTY)
  for (let row = 0; row < rows; row++) {
    const line = layout[row] || ""
    for (let col = 0; col < cols; col++) {
      const char = line[col] ?? "."
      if (char !== "." && char !== "0") {
        grid[col + row * cols] = Number(char) - 1
      }
    }
  }
  return collapse(grid, cols, rows)
}

// Everything falls to the lowest free cell in its column.
export function collapse(grid, cols, rows) {
  const out = new Int8Array(grid)
  for (let col = 0; col < cols; col++) {
    let free = rows - 1
    for (let row = rows - 1; row >= 0; row--) {
      const value = out[col + row * cols]
      if (value === EMPTY) {
        continue
      }
      out[col + row * cols] = EMPTY
      out[col + free * cols] = value
      free--
    }
  }
  return out
}

export const gridKey = (grid) => grid.join(",")

// Every distinct set of cells one legal chain could remove, each as the ordered path
// that takes them.
export function movesFrom(grid, cols, rows, minChain) {
  const found = new Map()
  const path = []
  const inPath = new Set()
  const walk = (cell, colour) => {
    path.push(cell)
    inPath.add(cell)
    if (path.length >= minChain) {
      const id = [...path].sort((a, b) => a - b).join(".")
      if (!found.has(id)) {
        found.set(id, [...path])
      }
    }
    const col = cell % cols
    const row = (cell - col) / cols
    const step = (nextCol, nextRow) => {
      if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) {
        return
      }
      const next = nextCol + nextRow * cols
      if (grid[next] !== colour || inPath.has(next)) {
        return
      }
      walk(next, colour)
    }
    step(col, row - 1)
    step(col + 1, row)
    step(col, row + 1)
    step(col - 1, row)
    path.pop()
    inPath.delete(cell)
  }
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] !== EMPTY) {
      walk(cell, grid[cell])
    }
  }
  // Biggest first: a solution is usually found far sooner by clearing the most.
  return [...found.values()].sort((a, b) => b.length - a.length)
}

export const isEmpty = (grid) => grid.every((value) => value === EMPTY)

// Can this layout be emptied? Returns the sequence of pops that does it.
export function solve(layout, cols, rows, minChain, budget = 200000) {
  const start = parse(layout, cols, rows)
  const seen = new Set([gridKey(start)])
  let states = 0
  const search = (grid) => {
    if (isEmpty(grid)) {
      return []
    }
    if (states >= budget) {
      return null
    }
    for (const cells of movesFrom(grid, cols, rows, minChain)) {
      states++
      const next = new Int8Array(grid)
      for (const cell of cells) {
        next[cell] = EMPTY
      }
      const settled = collapse(next, cols, rows)
      const id = gridKey(settled)
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      const rest = search(settled)
      if (rest) {
        return [cells, ...rest]
      }
      if (states >= budget) {
        return null
      }
    }
    return null
  }
  const found = search(start)
  return {
    solved: found != null,
    moves: found ? found.length : 0,
    states,
    // The solution as chains of { col, row }, in the order they are drawn, so a
    // caller can play it.
    sequence: found
      ? found.map((cells) =>
          cells.map((cell) => ({ col: cell % cols, row: Math.floor(cell / cols) })),
        )
      : [],
  }
}

// The most a level can score, over every order that clears it.
//
// This is computable, and cheaply, because every pop takes dots off the board and none
// puts any back: the positions reachable from a layout form a directed graph with no
// cycles, so each one need only be valued once. The multiplier is part of what is
// valued - the same position is worth more with a multiplier banked - so the memo is
// keyed on both.
//
// Only orders that empty the board are counted. Stranding a colour scores whatever was
// popped on the way, and sometimes more than clearing would, but it loses the level and
// the score with it: it is not a target a player could aim at.
//
// `scoreChain` and `multiplierAfter` are passed in rather than written here, so this
// cannot drift from what the game actually pays.
export function maxScore(layout, cols, rows, minChain, rules, budget = 4000000) {
  const start = parse(layout, cols, rows)
  const memo = new Map()
  let states = 0
  let exhausted = false
  // The best that can still be scored from this position, or null if it cannot be
  // cleared from here at all.
  const from = (grid, multiplier) => {
    if (isEmpty(grid)) {
      return 0
    }
    if (states >= budget) {
      exhausted = true
      return null
    }
    const id = `${gridKey(grid)}|${multiplier}`
    const known = memo.get(id)
    if (known !== undefined) {
      return known
    }
    states++
    let best = null
    for (const cells of movesFrom(grid, cols, rows, minChain)) {
      const next = new Int8Array(grid)
      for (const cell of cells) {
        next[cell] = EMPTY
      }
      const rest = from(collapse(next, cols, rows), rules.multiplierAfter(multiplier, cells.length))
      if (rest == null) {
        continue
      }
      const total = rules.scoreChain(cells.length) * multiplier + rest
      if (best == null || total > best) {
        best = total
      }
    }
    memo.set(id, best)
    return best
  }
  const best = from(start, 1)
  return { score: best, states, positions: memo.size, exhausted }
}

// The shape of a level, for a test failure to be readable.
export function describe(level, cols, rows) {
  const grid = parse(level.layout, cols, rows)
  const counts = new Map()
  for (const value of grid) {
    if (value !== EMPTY) {
      counts.set(value, (counts.get(value) || 0) + 1)
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const spread = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([colour, count]) => `${colour + 1}x${count}`)
    .join(" ")
  return `${String(total).padStart(2)} dots (${spread})`
}
