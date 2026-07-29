// A solver for the puzzle levels: what proves a level can actually be emptied, and what
// the most it can score is.
//
// Shared by three callers, which is why it lives here rather than beside a test. The level
// test proves every shipped level is clearable and that its par is the number written down;
// tools/levels.mjs reports on a candidate while it is being authored; and the editor scores
// a board as it is drawn.
//
// It works on colour codes rather than a Board, so it can search thousands of positions
// without allocating dots, and it applies the same two rules the game does: a chain is a
// simple path through cardinal neighbours of one colour, and every pop is followed by the
// columns collapsing.
//
// A position is **one word per column**, four bits per cell, packed up from the floor: a
// colour is stored as its code plus one, so nought means nothing there and a column's word is
// exactly as long as the dots standing in it. Two things follow, and they are most of what
// makes the search affordable. Collapsing is not an operation - a column that has had a dot
// taken out of it is the bits above the gap shifted down over it - and a whole position keys
// as two characters a column, twelve for the board the levels use, against forty-two for a
// cell each. Measured over the shipped levels, 1.43x on the walk as a whole.
//
// Four bits rather than three, which would also fit seven rows. Both need two characters a
// column, so the shorter field buys nothing unless columns are packed across the character
// boundary - and that costs a shifting loop that measures slower than the wider field it
// saves. Four bits also holds every digit a layout may use, where three stops at seven.
//
// `unpack` gives the flat grid back for anything that wants to look at cells: the move walk
// inside here, and the picker's preview through levelGrid.
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

// What an unpacked cell holds where there is no dot. Packed, that is simply a nought nibble.
export const EMPTY = -1

const CELL_BITS = 4
const CELL_MASK = 15
// Four bits a cell in a signed 32-bit word is as tall as a column may be. The board is seven,
// and a taller one would silently lose its top row, so it is worth saying out loud.
const MAX_ROWS = 7

// A layout - one string a row, a digit for a colour and a stop for a gap - as a position.
// Packing from the floor up is what settles it, so a layout drawn with dots in mid-air lands
// the same way the board would drop them.
export function parse(layout, cols, rows) {
  if (rows > MAX_ROWS) {
    throw new RangeError(`the solver packs ${MAX_ROWS} rows to a column, not ${rows}`)
  }
  const position = new Int32Array(cols)
  for (let col = 0; col < cols; col++) {
    let word = 0
    let at = 0
    for (let row = rows - 1; row >= 0; row--) {
      const char = (layout[row] || "")[col] ?? "."
      if (char === "." || char === "0") {
        continue
      }
      word |= Number(char) << (CELL_BITS * at)
      at++
    }
    position[col] = word
  }
  return position
}

// The flat grid a position stands for, a colour code per cell and EMPTY for a gap, indexed
// col + row * cols. What anything looking at neighbours needs, since the packing knows only
// about columns.
export function unpack(position, cols, rows) {
  const grid = new Int8Array(cols * rows).fill(EMPTY)
  for (let col = 0; col < cols; col++) {
    let word = position[col]
    for (let row = rows - 1; row >= 0 && word !== 0; row--) {
      grid[col + row * cols] = (word & CELL_MASK) - 1
      word >>>= CELL_BITS
    }
  }
  return grid
}

// How many dots of each colour are standing, by colour code. What "a colour is down to one dot"
// and "this level is nine dots in three colours" are both asked of.
export function coloursIn(position) {
  const counts = new Map()
  for (const column of position) {
    for (let word = column; word !== 0; word >>>= CELL_BITS) {
      const colour = (word & CELL_MASK) - 1
      counts.set(colour, (counts.get(colour) || 0) + 1)
    }
  }
  return counts
}

// Two characters a column, which is what a memo is keyed on. Built once per position and once
// per move, so it is the most-run line here.
let keyBuffer = new Uint16Array(0)
export function positionKey(position) {
  if (keyBuffer.length !== position.length * 2) {
    keyBuffer = new Uint16Array(position.length * 2)
  }
  for (let col = 0; col < position.length; col++) {
    keyBuffer[col * 2] = position[col] & 0xffff
    keyBuffer[col * 2 + 1] = position[col] >>> 16
  }
  return String.fromCharCode.apply(null, keyBuffer)
}

// A board's identity, as text that survives a file: the packed columns in hex, low column first.
//
// positionKey is for memos and is built from raw sixteen bit values, which are not all printable and
// not all valid on their own in a JSON string. This is for writing down - the cache of boards that
// have already been judged, which both the level test and the search read - so it trades a little
// length for being copyable, greppable and diffable.
export function boardId(position) {
  let id = ""
  for (const column of position) {
    id += (column >>> 0).toString(16).padStart(8, "0")
  }
  return id
}

// The position a move leaves, given the cells it takes as indices into the unpacked grid.
// Everything above a gap shifts down over it, which is the whole of gravity here.
let takenBuffer = new Int32Array(0)
export function without(position, cells, cols, rows) {
  const out = new Int32Array(position)
  if (takenBuffer.length !== cols) {
    takenBuffer = new Int32Array(cols)
  }
  // A bit per height above the floor, so a column is rebuilt in one pass however many it loses.
  for (const cell of cells) {
    const col = cell % cols
    takenBuffer[col] |= 1 << (rows - 1 - (cell - col) / cols)
  }
  for (let col = 0; col < cols; col++) {
    const gaps = takenBuffer[col]
    if (gaps === 0) {
      continue
    }
    let word = out[col]
    let rebuilt = 0
    let at = 0
    let shift = 0
    while (word !== 0) {
      if ((gaps & (1 << at)) === 0) {
        rebuilt |= (word & CELL_MASK) << shift
        shift += CELL_BITS
      }
      word >>>= CELL_BITS
      at++
    }
    out[col] = rebuilt
    takenBuffer[col] = 0
  }
  return out
}

// Which columns can ever affect each other, as a group number per column.
//
// Two columns can only interact if they hold a colour in common: a chain is one colour and
// cardinally connected, and the only thing that moves a dot is gravity, which works down a
// column. So a board whose columns share no colours is not one puzzle but several side by side,
// and the positions of the whole are the product of the positions of each - which is why one
// more full column of a new colour costs eight times as much and not a little more.
//
// An empty column belongs to no group.
export function columnGroups(position) {
  const cols = position.length
  const colours = []
  for (let col = 0; col < cols; col++) {
    const here = new Set()
    for (let word = position[col]; word !== 0; word >>>= CELL_BITS) {
      here.add(word & CELL_MASK)
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
export function columnsOnly(position, keep) {
  const out = new Int32Array(position.length)
  for (let col = 0; col < position.length; col++) {
    if (keep(col)) {
      out[col] = position[col]
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
export function movesFrom(position, cols, rows, minChain, limit = Infinity) {
  const moves = []
  let truncated = false

  // Neighbours are what a chain is made of and the packing knows only about columns, so this is
  // the one place a position is spread back out - once, however many chains come off it.
  const grid = unpack(position, cols, rows)
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

export const isEmpty = (position) => position.every((word) => word === 0)

// Can this layout be emptied? Returns the sequence of pops that does it.
export function solve(layout, cols, rows, minChain, budget = 200000) {
  const start = parse(layout, cols, rows)
  const seen = new Set([positionKey(start)])
  let states = 0
  const search = (position) => {
    if (isEmpty(position)) {
      return []
    }
    if (states >= budget) {
      return null
    }
    const { moves } = movesFrom(position, cols, rows, minChain, MOVE_LIMIT)
    for (const cells of moves) {
      states++
      const settled = without(position, cells, cols, rows)
      const id = positionKey(settled)
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
export function outcomesFrom(position, cols, rows, minChain, limit = Infinity) {
  const { moves, truncated } = movesFrom(position, cols, rows, minChain, limit)
  const seen = new Map()
  for (const cells of moves) {
    const settled = without(position, cells, cols, rows)
    const key = positionKey(settled)
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

// The shape of a level, for a test failure to be readable.
export function describe(level, cols, rows) {
  const counts = coloursIn(parse(level.layout, cols, rows))
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const spread = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([colour, count]) => `${colour + 1}x${count}`)
    .join(" ")
  return `${String(total).padStart(2)} dots (${spread})`
}
