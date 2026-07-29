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
// And two flags for how far to trust that, which are not the same flag. `exact` covers par and
// floor; `statsExact` covers everything else, because a board that splits into independent parts
// has its par and floor answered by the parts while the rest still comes from a whole-board walk
// that is cut short once they have.
//
// The scoring rules are passed in rather than written here, so this cannot drift from what
// the game pays.

import {
  parse,
  unpack,
  without,
  movesFrom,
  outcomesFrom,
  columnGroups,
  columnsOnly,
  coloursIn,
  isEmpty,
  positionKey,
  EMPTY,
  MOVE_LIMIT,
} from "./solver.js"

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

// What an answer from here depends on, besides the board itself.
//
// Anything cached against a board has to know whether the thing that judged it is still the thing
// judging it now. Two halves, because two kinds of change happen:
//
//   - the rules and the weights, derived below, so changing what a chain pays or how difficulty is
//     weighed invalidates the cache on its own.
//   - MEASURE, declared, for a change in how the search *arrives* at an answer. A cache cannot
//     detect that a bug was fixed. par decomposition being wrong changed one level's par with no
//     rule changed at all, and a cache would have gone on serving the old number. So: **bump this
//     whenever a change to solver.js or analysis.js can change what analyse returns.**
export const MEASURE = 4

export function measureFingerprint(rules, minChain) {
  const paid = []
  for (let length = 2; length <= 9; length++) {
    paid.push(`${length}:${rules.scoreChain(length)}`)
  }
  const ramp = []
  for (let multiplier = 1; multiplier <= 9; multiplier++) {
    ramp.push(
      `${multiplier}>${rules.multiplierAfter(multiplier, 4)}/${rules.multiplierAfter(multiplier, 2)}`,
    )
  }
  const weights = Object.entries(DIFFICULTY)
    .map(([name, value]) => `${name}=${Array.isArray(value) ? value.join(".") : value}`)
    .join(",")
  return `m${MEASURE};min${minChain};cap${MOVE_LIMIT};${paid.join(",")};${ramp.join(",")};${weights}`
}

export function analyse(layout, cols, rows, minChain, rules, options = {}) {
  const budget = options.budget ?? 4000000
  // Wall clock as well as a state count. One large region of a single colour makes the move
  // enumeration explode on its own - every connected subset of a blob is a distinct move -
  // so a position budget alone does not bound how long this takes. The editor runs it on
  // every edit and needs an answer either way.
  const deadline = Date.now() + (options.seconds ?? 20) * 1000
  const start = parse(layout, cols, rows)
  // Outcomes, not moves: two chains of the same length leaving the same board are the same play
  // and are valued once. See outcomesFrom, which is where the symmetry of a board goes.
  const listOf = (position) => outcomesFrom(position, cols, rows, minChain, MOVE_LIMIT)

  // One walk of the graph, answering everything at once. `best` and `worst` are the most
  // and least a clearing order pays from here; `paths` is how many reach `best`. A null
  // `best` means this position cannot be cleared, which is what a trap leads to.
  const memo = new Map()
  let states = 0
  let exhausted = false
  // Whether any position offered more chains than could be listed. Nothing exact can be said
  // about a board where that happened: a move that was not listed might have been the one that
  // cleared it, so "cannot be cleared" becomes "cannot be told".
  let truncated = false
  let moveCount = 0
  let trapCount = 0
  let silentTrapCount = 0

  const from = (position, key, multiplier) => {
    if (isEmpty(position)) {
      return { best: 0, worst: 0, paths: 1, depth: 0 }
    }
    if (states >= budget || (states % 512 === 0 && Date.now() > deadline)) {
      exhausted = true
      return { best: null, worst: null, paths: 0, depth: 0 }
    }
    const id = `${key}|${multiplier}`
    const known = memo.get(id)
    if (known !== undefined) {
      return known
    }
    states++
    let best = null
    let worst = null
    let paths = 0
    let depth = 0
    const here = listOf(position)
    if (here.truncated) {
      truncated = true
    }
    for (const outcome of here.outcomes) {
      const { cells, child } = outcome
      const rest = from(child, outcome.key, rules.multiplierAfter(multiplier, cells.length))
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

  const root = from(start, positionKey(start), 1)

  // The opening moves, and how many of them lose the level on the spot - split by whether
  // the loss is one a player would see. This is the trap measure that reaches the difficulty,
  // since the opening is where there is least to go on.
  let firstMoves = 0
  let firstTraps = 0
  let firstSilent = 0
  for (const outcome of listOf(start).outcomes) {
    firstMoves++
    const rest = memo.get(`${outcome.key}|${rules.multiplierAfter(1, outcome.cells.length)}`)
    if (!rest || rest.best == null) {
      firstTraps++
      if (!announces(outcome.child)) {
        firstSilent++
      }
    }
  }

  const greedy = playGreedily(start, cols, rows, minChain, rules)
  // Three answers, not two: cleared, provably not, or not established. A search that ran out of
  // time or out of moves to list has proved nothing either way.
  let clearable = root.best != null ? true : exhausted || truncated ? null : false
  const par = root.best
  const floor = root.worst

  // Where the whole board could not be walked, its parts may still each be walkable - and a board
  // is clearable exactly when every part is. Only that question: par and floor stay with the walk.
  // See partsClearable.
  const parts =
    clearable === true
      ? { groups: 0 }
      : partsClearable(start, cols, rows, minChain, MOVE_LIMIT, deadline)
  if (parts.clearable != null) {
    clearable = parts.clearable
  }
  const decomposed = parts.groups
  const trapRate = moveCount > 0 ? trapCount / moveCount : 0
  const silentTrapRate = moveCount > 0 ? silentTrapCount / moveCount : 0

  let difficulty = 0
  if (clearable === true && root.best != null) {
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
    par,
    floor,
    // Whether par and floor are the real numbers. A decomposed answer is exact even though the
    // whole-board walk did not finish: the parts were each walked to the end.
    truncated,
    exact: clearable === true && par != null && !truncated && !exhausted,
    // And whether everything below is. The parts answer par and floor and nothing else: how many
    // orders pay par, how long one is, and which openings are traps all come from the whole-board
    // walk, which is cut short as soon as the parts have answered. A walk that stopped early
    // undercounts the orders it found and reads every position it never reached as a trap, so
    // anything weighing those - the difficulty most of all - has to know.
    statsExact: clearable === true && !truncated && !exhausted,
    // How many independent boards this turned out to be, where that is how it was answered. A
    // level that is several unrelated puzzles side by side is worth telling its author about.
    decomposed,
    // Whether how it is played changes what it pays, which is what the picker marks.
    forced: clearable === true && floor === par,
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
function announces(position) {
  for (const count of coloursIn(position).values()) {
    if (count === 1) {
      return true
    }
  }
  return false
}

// The largest connected run of one colour, which is what the search cost is governed by:
// every connected subset of a region is a distinct move, so a big blob of one colour is
// expensive out of all proportion to the number of dots on the board.
function biggestRegion(position, cols, rows) {
  const grid = unpack(position, cols, rows)
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

// Whether a board that is really several boards side by side can be cleared at all.
//
// Columns sharing no colour can never affect each other, so the whole is clearable exactly when
// every part is - and each part's own positions are a tiny fraction of the product the whole board
// makes. Five full columns of five colours is eight to the fifth as one board and eight times five
// as five, which is the difference between not finishing and finishing at once.
//
// **Only clearability.** Par cannot be decomposed this way, and an earlier version of this that
// tried to was wrong: it collected the multisets of chain lengths each part could be cleared with,
// merged one from each, and valued the merged multiset over every order. Interleaving *across* parts
// is indeed free, but that treats each part's chains as freely reorderable *within* the part, and
// they are not - a multiset comes from one particular clearing order, and the collapse decides which
// orders exist. On level 16 it claimed 2577 where no real order beats 2450, by asking a part to play
// its chains 5, 6, 7 when that part can only reach that multiset another way round.
//
// Fixing it properly would mean tracking each part's achievable *sequences* and interleaving those,
// whose state is how far along each part every sequence has got - which is the product of the parts'
// positions, which is the whole-board walk. So there is nothing to be saved here for par, and par
// comes from that walk or is a bound.
function partsClearable(start, cols, rows, minChain, limit, deadline) {
  const { group, groups } = columnGroups(start)
  if (groups < 2) {
    return { groups, clearable: null }
  }
  for (let index = 0; index < groups; index++) {
    const part = columnsOnly(start, (col) => group[col] === index)
    const answer = canClear(part, cols, rows, minChain, limit, deadline)
    if (answer !== true) {
      // One part that cannot be cleared settles the whole board; one that could not be judged
      // leaves the whole board unjudged.
      return { groups, clearable: answer }
    }
  }
  return { groups, clearable: true }
}

// Can this board be emptied? true, false, or null where it could not be established. Positions
// only, with no multiplier: whether a board can be cleared does not depend on what is banked.
function canClear(start, cols, rows, minChain, limit, deadline) {
  const memo = new Map()
  let gaveUp = false
  const from = (position, key) => {
    if (isEmpty(position)) {
      return true
    }
    if (Date.now() > deadline) {
      gaveUp = true
      return false
    }
    const known = memo.get(key)
    if (known !== undefined) {
      return known
    }
    memo.set(key, false)
    const here = outcomesFrom(position, cols, rows, minChain, limit)
    if (here.truncated) {
      gaveUp = true
      return false
    }
    for (const outcome of here.outcomes) {
      if (from(outcome.child, outcome.key)) {
        memo.set(key, true)
        return true
      }
    }
    return false
  }
  const cleared = from(start, positionKey(start))
  return cleared ? true : gaveUp ? null : false
}

// An order of chains that actually scores par, or null where the whole board could not be walked.
//
// What this is for is checking the claim rather than making it. par comes from two places - the
// whole-board walk, or, on a board that splits into independent parts, from merging what each part
// can be cleared with and valuing every order the merged multiset could be played in. The second is
// a construction, and a construction deserves a witness: the level test takes this route, plays it
// through the real game, and asserts the score comes out at par. That checks the two methods against
// each other and checks that both agree with what the game actually pays.
//
// Deliberately the plain walk, with no leash but a generous position budget: it is a cross-check, so
// sharing machinery with the thing it checks would defeat it. The budget covers the largest shipped
// level, which is thirty dots and takes about a minute; past it this returns nothing rather than a
// route that is merely the best one found so far.
export function parRoute(layout, cols, rows, minChain, rules, budget = 40000000) {
  const start = parse(layout, cols, rows)
  const memo = new Map()
  let states = 0
  let exhausted = false
  // The best still to be had from here, and the chain to take to get it.
  const from = (position, key, multiplier) => {
    if (isEmpty(position)) {
      return { best: 0, cells: null, next: null }
    }
    const id = `${key}|${multiplier}`
    const known = memo.get(id)
    if (known !== undefined) {
      return known
    }
    // Counted after the memo, so this is positions valued and not calls made - there are far more
    // calls than positions, and counting those ran out of budget on a board that fits easily.
    if (states++ >= budget) {
      exhausted = true
      return { best: null, cells: null, next: null }
    }
    let found = { best: null, cells: null, next: null }
    for (const outcome of outcomesFrom(position, cols, rows, minChain, MOVE_LIMIT).outcomes) {
      const after = rules.multiplierAfter(multiplier, outcome.cells.length)
      const rest = from(outcome.child, outcome.key, after)
      if (rest.best == null) {
        continue
      }
      const total = rules.scoreChain(outcome.cells.length) * multiplier + rest.best
      if (found.best == null || total > found.best) {
        found = {
          best: total,
          cells: outcome.cells,
          next: { position: outcome.child, key: outcome.key, multiplier: after },
        }
      }
    }
    memo.set(id, found)
    return found
  }

  let step = from(start, positionKey(start), 1)
  // Nothing rather than something smaller: a route found while the walk was running out is not the
  // best route, and returning it would have the caller compare par against a number that was never
  // a claim about par.
  if (step.best == null || exhausted) {
    return null
  }
  const score = step.best
  const route = []
  while (step.cells) {
    route.push(step.cells.map((cell) => ({ col: cell % cols, row: Math.floor(cell / cols) })))
    step = from(step.next.position, step.next.key, step.next.multiplier)
  }
  return { score, route }
}

// The obvious way to play, from a layout: what the search uses to throw out a candidate before
// spending real time on it, since a level at the hard end always punishes greed.
//
// The obvious way to play: take the longest chain on the board, every time. Ties go to the
// one the move list found first, which is the top-left of the board - a player's eye has to
// start somewhere too.
export function greedily(layout, cols, rows, minChain, rules) {
  return playGreedily(parse(layout, cols, rows), cols, rows, minChain, rules)
}

function playGreedily(start, cols, rows, minChain, rules) {
  let position = start
  let multiplier = 1
  let score = 0
  let moves = 0
  for (;;) {
    if (isEmpty(position)) {
      return { clears: true, score, moves }
    }
    const options = movesFrom(position, cols, rows, minChain, MOVE_LIMIT).moves
    if (options.length === 0) {
      return { clears: false, score, moves }
    }
    const cells = options[0]
    score += rules.scoreChain(cells.length) * multiplier
    multiplier = rules.multiplierAfter(multiplier, cells.length)
    moves++
    position = without(position, cells, cols, rows)
  }
}
