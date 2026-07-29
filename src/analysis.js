// What can be known about a puzzle level without playing it.
//
// Every question here is finite and exactly answerable, for the same reason par is: a pop
// only ever takes dots off the board, so the positions reachable from a layout form a
// directed graph with no cycles. Walking it once answers all of them at the same time.
//
// What comes out:
//
//   clearable   whether the board can be emptied at all. A level that cannot is not a
//               level, and the editor refuses to save one.
//   par         the most any clearing order scores. See maxScore in solver.js.
//   floor       the least any clearing order scores. This is what says whether how you
//               play matters: where the floor is the par, every order that clears pays
//               the same and there is nothing to aim at.
//   parPaths    how many distinct orders reach par. One means there is a single best
//               solution to find.
//   trapRate    over the whole graph, the share of legal moves that strand the board. How
//               punishing it is: a level with none of these cannot be lost.
//   firstTraps  how many of the opening moves strand it, which is trapRate at the point
//               where a player has the least to go on.
//   greedy      what taking the longest chain available every time does. The obvious way
//               to play: a level where it clears and pays par asks nothing.
//   difficulty  1 to 5, from the above. See DIFFICULTY.
//
// The scoring rules are passed in rather than written here, so this cannot drift from what
// the game pays.

import { parse, collapse, movesFrom, isEmpty, gridKey, EMPTY } from "./solver.js"

// What difficulty is made of. A level is hard when it is long, when there is a lot of it to
// hold in the head at once, when a wrong opening loses it, when the obvious play is wrong,
// and when only one order pays best.
//
// The size term is the log of the positions searched, not the share of moves that strand the
// board. Trap rate on its own reads a nine dot level with two of everything as harder than a
// twenty-two dot lock, because almost any move on a tiny board leaves something orphaned -
// but the whole board is in view at once and a player sees it. What is hard is how much has
// to be considered, which is what the position count measures.
//
// Traps are counted by whether the mistake announces itself. A board of towers in four
// easy colours is full of moves that strand a pair, but they leave a dot sitting on its own
// with nothing of its colour beside it, and nobody plays into that twice. What is worth
// weighting is the trap that leaves a board where everything still looks matchable. So an
// opening that strands something visibly is worth a fraction of one that does not; see
// announces().
const DIFFICULTY = {
  perMove: 0.45,
  perDecade: 0.8,
  silentTrapWeight: 3,
  announcedTrapWeight: 0.6,
  greedyStrands: 3,
  greedyMissesPar: 1.5,
  onlyOnePar: 1.5,
  // Where each band starts, so the number turns into something a picker can draw.
  bands: [0, 3.5, 6, 8.5, 11],
}

export function analyse(layout, cols, rows, minChain, rules, options = {}) {
  const budget = options.budget ?? 4000000
  // Wall clock as well as a state count. One large region of a single colour makes the move
  // enumeration explode on its own - every connected subset of a blob is a distinct move -
  // so a position budget alone does not bound how long this takes. The editor runs it on
  // every edit and needs an answer either way.
  const deadline = Date.now() + (options.seconds ?? 20) * 1000
  const start = parse(layout, cols, rows)
  const moveList = (grid) => movesFrom(grid, cols, rows, minChain)
  const after = (grid, cells) => {
    const next = new Int8Array(grid)
    for (const cell of cells) {
      next[cell] = EMPTY
    }
    return collapse(next, cols, rows)
  }

  // One walk of the graph, answering everything at once. `best` and `worst` are the most
  // and least a clearing order pays from here; `paths` is how many reach `best`. A null
  // `best` means this position cannot be cleared, which is what a trap leads to.
  const memo = new Map()
  let states = 0
  let exhausted = false
  let moveCount = 0
  let trapCount = 0
  let silentTrapCount = 0

  const from = (grid, multiplier) => {
    if (isEmpty(grid)) {
      return { best: 0, worst: 0, paths: 1, depth: 0 }
    }
    if (states >= budget || (states % 512 === 0 && Date.now() > deadline)) {
      exhausted = true
      return { best: null, worst: null, paths: 0, depth: 0 }
    }
    const id = `${gridKey(grid)}|${multiplier}`
    const known = memo.get(id)
    if (known !== undefined) {
      return known
    }
    states++
    // Placed before the recursion so a position reached again while it is still being
    // valued is not walked twice. The graph has no cycles, so this is only ever read by a
    // later sibling, never by this position's own descendants.
    memo.set(id, { best: null, worst: null, paths: 0, depth: 0 })
    let best = null
    let worst = null
    let paths = 0
    let depth = 0
    for (const cells of moveList(grid)) {
      const child = after(grid, cells)
      const rest = from(child, rules.multiplierAfter(multiplier, cells.length))
      moveCount++
      if (rest.best == null) {
        trapCount++
        if (!announces(child)) {
          silentTrapCount++
        }
        continue
      }
      const scored = rules.scoreChain(cells.length) * multiplier
      const total = scored + rest.best
      const low = scored + rest.worst
      if (best == null || total > best) {
        best = total
        paths = rest.paths
        depth = rest.depth + 1
      } else if (total === best) {
        paths += rest.paths
      }
      if (worst == null || low < worst) {
        worst = low
      }
    }
    const value = { best, worst, paths, depth }
    memo.set(id, value)
    return value
  }

  const root = from(start, 1)

  // The opening moves, and how many of them lose the level on the spot - split by whether
  // the loss is one a player would see. This is the trap measure that reaches the difficulty,
  // since the opening is where there is least to go on.
  let firstMoves = 0
  let firstTraps = 0
  let firstSilent = 0
  for (const cells of moveList(start)) {
    firstMoves++
    const child = after(start, cells)
    const rest = memo.get(`${gridKey(child)}|${rules.multiplierAfter(1, cells.length)}`)
    if (!rest || rest.best == null) {
      firstTraps++
      if (!announces(child)) {
        firstSilent++
      }
    }
  }

  const greedy = playGreedily(start, cols, rows, minChain, rules)
  const clearable = root.best != null && !exhausted
  const trapRate = moveCount > 0 ? trapCount / moveCount : 0
  const silentTrapRate = moveCount > 0 ? silentTrapCount / moveCount : 0

  let difficulty = 0
  if (clearable) {
    difficulty =
      root.depth * DIFFICULTY.perMove +
      Math.log10(Math.max(states, 1)) * DIFFICULTY.perDecade +
      (firstMoves > 0 ? firstSilent / firstMoves : 0) * DIFFICULTY.silentTrapWeight +
      (firstMoves > 0 ? (firstTraps - firstSilent) / firstMoves : 0) *
        DIFFICULTY.announcedTrapWeight +
      (greedy.clears ? 0 : DIFFICULTY.greedyStrands) +
      (greedy.clears && greedy.score < root.best ? DIFFICULTY.greedyMissesPar : 0) +
      (root.paths === 1 ? DIFFICULTY.onlyOnePar : 0)
  }

  return {
    clearable,
    par: root.best,
    floor: root.worst,
    // Whether how it is played changes what it pays, which is what the picker marks.
    forced: clearable && root.worst === root.best,
    parPaths: root.paths,
    moves: root.depth,
    trapRate,
    silentTrapRate,
    firstMoves,
    firstTraps,
    firstSilent,
    biggestRegion: biggestRegion(start, cols, rows),
    timedOut: exhausted && Date.now() > deadline,
    greedy,
    difficulty,
    band: DIFFICULTY.bands.filter((edge) => difficulty >= edge).length,
    positions: memo.size,
    states,
    exhausted,
  }
}

// Does this position prove, on sight, that it is lost?
//
// One dot of a colour with no other dot of that colour anywhere is the answer: nothing
// refills, so it can never be matched, and a player looking at the board can see that as
// plainly as the solver can. Every opening trap in the original seven levels is this kind,
// which is why they play as forgiving despite most of their moves stranding the board.
//
// A dot merely having no same-colour dot *beside* it is not the same thing and is not counted:
// a collapse can bring two of them together several moves later, so a player cannot know it is
// a mistake, and neither can anything short of the search. Those are the traps worth weighting,
// and the ones a hard level is made of.
function announces(grid) {
  const counts = new Map()
  for (const colour of grid) {
    if (colour !== EMPTY) {
      counts.set(colour, (counts.get(colour) || 0) + 1)
    }
  }
  for (const count of counts.values()) {
    if (count === 1) {
      return true
    }
  }
  return false
}

// The largest connected run of one colour, which is what the search cost is governed by:
// every connected subset of a region is a distinct move, so a big blob of one colour is
// expensive out of all proportion to the number of dots on the board.
function biggestRegion(grid, cols, rows) {
  const seen = new Uint8Array(grid.length)
  let biggest = 0
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] === EMPTY || seen[cell]) {
      continue
    }
    const colour = grid[cell]
    let size = 0
    const stack = [cell]
    seen[cell] = 1
    while (stack.length > 0) {
      const at = stack.pop()
      size++
      const col = at % cols
      const row = (at - col) / cols
      const step = (nextCol, nextRow) => {
        if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) {
          return
        }
        const next = nextCol + nextRow * cols
        if (grid[next] === colour && !seen[next]) {
          seen[next] = 1
          stack.push(next)
        }
      }
      step(col - 1, row)
      step(col + 1, row)
      step(col, row - 1)
      step(col, row + 1)
    }
    biggest = Math.max(biggest, size)
  }
  return biggest
}

// The obvious way to play: take the longest chain on the board, every time. Ties go to the
// one the move list found first, which is the top-left of the board - a player's eye has to
// start somewhere too.
function playGreedily(start, cols, rows, minChain, rules) {
  let grid = new Int8Array(start)
  let multiplier = 1
  let score = 0
  let moves = 0
  for (;;) {
    if (isEmpty(grid)) {
      return { clears: true, score, moves }
    }
    const options = movesFrom(grid, cols, rows, minChain)
    if (options.length === 0) {
      return { clears: false, score, moves }
    }
    const cells = options[0]
    score += rules.scoreChain(cells.length) * multiplier
    multiplier = rules.multiplierAfter(multiplier, cells.length)
    moves++
    const next = new Int8Array(grid)
    for (const cell of cells) {
      next[cell] = EMPTY
    }
    grid = collapse(next, cols, rows)
  }
}
