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

// The most chains one position may offer before the list is cut short. The shipped levels peak
// in the hundreds; a region of one colour twenty-four cells across offers a hundred and fifty
// thousand, which is not a level anyone would play and not a list worth building.
export const MOVE_LIMIT = 3000

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

// One character per cell. Built once per position and once per move, so it is worth the
// three times it saves over joining numbers with separators.
export const gridKey = (grid) => String.fromCharCode.apply(null, grid)

// Which columns can ever affect each other, as a group number per column.
//
// Two columns can only interact if they hold a colour in common: a chain is one colour and
// cardinally connected, and the only thing that moves a dot is gravity, which works down a
// column. So a board whose columns share no colours is not one puzzle but several side by side,
// and the positions of the whole are the product of the positions of each - which is why one
// more full column of a new colour costs eight times as much and not a little more.
//
// An empty column belongs to no group.
export function columnGroups(grid, cols, rows) {
  const colours = []
  for (let col = 0; col < cols; col++) {
    const here = new Set()
    for (let row = 0; row < rows; row++) {
      const value = grid[col + row * cols]
      if (value !== EMPTY) {
        here.add(value)
      }
    }
    colours.push(here)
  }
  const group = new Array(cols).fill(-1)
  let groups = 0
  for (let col = 0; col < cols; col++) {
    if (group[col] >= 0 || colours[col].size === 0) {
      continue
    }
    const stack = [col]
    group[col] = groups
    while (stack.length > 0) {
      const from = stack.pop()
      for (let other = 0; other < cols; other++) {
        if (group[other] >= 0 || colours[other].size === 0) {
          continue
        }
        for (const colour of colours[from]) {
          if (colours[other].has(colour)) {
            group[other] = groups
            stack.push(other)
            break
          }
        }
      }
    }
    groups++
  }
  return { group, groups }
}

// One group's columns on their own board, so it can be judged by itself.
export function columnsOnly(grid, cols, rows, keep) {
  const out = new Int8Array(grid.length).fill(EMPTY)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (keep(col)) {
        out[col + row * cols] = grid[col + row * cols]
      }
    }
  }
  return out
}

// Every distinct set of cells one legal chain could remove, each as the ordered path that
// takes them, biggest first. `limit` caps how many are returned; see MOVE_LIMIT.
//
// A chain is a simple path, so this walks paths - but the same set of cells is reached by many
// orders and only the set matters, and walking every order is the difference between thousands
// of steps and billions. Two things keep it down:
//
//   - a walk is memoised on (where it is now, what it has taken). What can be reached from
//     there depends on those two and nothing else, so a state reached a second time by another
//     order has nothing left to discover. The mask is over cells of one region, so it fits in
//     an integer.
//   - a region of one colour bigger than about twenty cells has more legal chains through it
//     than can be listed at all - twenty-four in a block have a hundred and fifty thousand -
//     so the count is capped and the caller is told the list is short. Nothing can be
//     concluded from a truncated list, which is what `truncated` is for.
export function movesFrom(grid, cols, rows, minChain, limit = Infinity) {
  const moves = []
  let truncated = false

  // The regions of one colour, so a mask can be per region rather than per board.
  const regionOf = new Int8Array(grid.length).fill(-1)
  const regions = []
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] === EMPTY || regionOf[cell] >= 0) {
      continue
    }
    const colour = grid[cell]
    const members = [cell]
    regionOf[cell] = regions.length
    for (let at = 0; at < members.length; at++) {
      const here = members[at]
      const col = here % cols
      const row = (here - col) / cols
      const step = (nextCol, nextRow) => {
        if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) {
          return
        }
        const next = nextCol + nextRow * cols
        if (grid[next] === colour && regionOf[next] < 0) {
          regionOf[next] = regions.length
          members.push(next)
        }
      }
      step(col, row - 1)
      step(col + 1, row)
      step(col, row + 1)
      step(col - 1, row)
    }
    regions.push(members)
  }

  for (const members of regions) {
    if (members.length < minChain) {
      continue
    }
    const size = members.length
    const local = new Map(members.map((cell, index) => [cell, index]))
    // Cells of this region beside each cell of it, by local index.
    const beside = members.map((cell) => {
      const col = cell % cols
      const row = (cell - col) / cols
      return [
        [col, row - 1],
        [col + 1, row],
        [col, row + 1],
        [col - 1, row],
      ]
        .map(([c, r]) =>
          c < 0 || r < 0 || c >= cols || r >= rows ? undefined : local.get(c + r * cols),
        )
        .filter((index) => index !== undefined)
    })

    const seenState = new Set()
    const seenSet = new Set()
    const path = []
    let full = false
    const walk = (index, mask) => {
      if (full) {
        return
      }
      const state = mask * size + index
      if (seenState.has(state)) {
        return
      }
      seenState.add(state)
      if (path.length >= minChain && !seenSet.has(mask)) {
        seenSet.add(mask)
        moves.push(path.map((at) => members[at]))
        if (moves.length >= limit) {
          full = true
          truncated = true
          return
        }
      }
      for (const next of beside[index]) {
        const bit = 1 << next
        if (mask & bit) {
          continue
        }
        path.push(next)
        walk(next, mask | bit)
        path.pop()
      }
    }
    // Past what a mask can hold, and far past counting anyway. Rather than offer nothing - which
    // would leave a board of one colour looking unplayable when it is the easiest board there
    // is - take one long greedy path from each cell and its prefixes. Enough to clear such a
    // board with, and honestly marked short.
    if (size > 30) {
      truncated = true
      for (const cells of greedyPaths(members, beside, minChain)) {
        moves.push(cells)
      }
      continue
    }
    for (let index = 0; index < size; index++) {
      path.length = 0
      path.push(index)
      walk(index, 1 << index)
      if (full) {
        break
      }
    }
  }

  // Biggest first: a solution is usually found far sooner by clearing the most.
  moves.sort((a, b) => b.length - a.length)
  return { moves, truncated }
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
    const { moves } = movesFrom(grid, cols, rows, minChain, MOVE_LIMIT)
    for (const cells of moves) {
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

// The distinct *outcomes* one move can have, rather than the distinct moves.
//
// This is where the symmetry goes. Nothing downstream can tell two chains apart if they are the
// same length and leave the same board: the score is a function of the length, so is the
// multiplier, and the future is a function of the board. A field of one colour has a hundred and
// fifty thousand legal chains through it and a few dozen outcomes, because taking five cells
// from a column leaves the same board wherever along it they were taken, and a snake has four
// ways round that are the same play.
//
// So each outcome is kept once, with one of the chains that reaches it - which is what makes a
// solution replayable - and the collapsed board it leads to, which the caller needs anyway.
export function outcomesFrom(grid, cols, rows, minChain, limit = Infinity) {
  const { moves, truncated } = movesFrom(grid, cols, rows, minChain, limit)
  const seen = new Map()
  for (const cells of moves) {
    const child = new Int8Array(grid)
    for (const cell of cells) {
      child[cell] = EMPTY
    }
    const settled = collapse(child, cols, rows)
    const key = gridKey(settled)
    // Length as well as board: the same board reached by a longer chain is a different play,
    // worth more and leaving a different multiplier.
    const id = `${key}|${cells.length}`
    if (!seen.has(id)) {
      seen.set(id, { cells, child: settled, key })
    }
  }
  return { outcomes: [...seen.values()], truncated }
}

// A handful of long chains through a region too big to enumerate: from each cell, walk as far as
// it goes taking the first cell it can each time, and keep that path and its longer prefixes.
// Not all the moves there are - nothing like it - but real ones, and long, which is what a board
// of one colour needs to be cleared with.
function greedyPaths(members, beside, minChain) {
  const paths = []
  for (let start = 0; start < members.length; start++) {
    const taken = new Uint8Array(members.length)
    const path = [start]
    taken[start] = 1
    for (;;) {
      const next = beside[path[path.length - 1]].find((index) => !taken[index])
      if (next === undefined) {
        break
      }
      taken[next] = 1
      path.push(next)
    }
    // The whole run and a couple of shorter ones, so there is a choice of how much to take.
    for (const length of new Set([path.length, Math.ceil(path.length / 2), minChain])) {
      if (length >= minChain && length <= path.length) {
        paths.push(path.slice(0, length).map((index) => members[index]))
      }
    }
  }
  return paths
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
    for (const cells of movesFrom(grid, cols, rows, minChain, MOVE_LIMIT).moves) {
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
