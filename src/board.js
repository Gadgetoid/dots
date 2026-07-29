// The board: a grid of dots, the rules for linking them, and the collapse and
// refill that follow a pop.
//
// The logical board is never mid-animation. A pop removes dots from the grid and
// the survivors are given their new rows immediately; each dot then falls toward
// the row it already belongs to, so a question like "is there a move left" is
// always asked of a settled, consistent grid. What the player sees catching up is
// purely the dots' own business.
//
// Nothing here draws, and nothing here knows about a theme: a dot's colour is an
// index, and the view decides what that looks like. That also means the whole
// board is testable without a browser.

import { CONFIG } from "./config.js"
import { DOT_COLOURS } from "./palette.js"
import { clamp, springStep } from "./math.js"
import { dealSpecial } from "./specials.js"

// A chain runs through cardinal neighbours only - never diagonals - which is the
// rule the game has had since the RaphaelJS original.
const CARDINALS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

export class Dot {
  constructor(col, row, colour) {
    this.col = col
    this.row = row // where it belongs in the grid
    this.colour = colour // index into the theme's dot colours
    this.y = row // where it is drawn, in cells; chases `row`
    this.vy = 0
    // The jelly, as one damped oscillator: positive stretches the dot along
    // `wobbleAxis` and squashes it across, and the ring swaps the two.
    this.wobble = { value: 0, velocity: 0 }
    this.wobbleAxis = 0
    // How much a dot swells while it is held in a chain, eased rather than
    // snapped so picking one up has some give.
    this.swell = 0
    this.linked = false
    // A powerup riding on this dot, as an id into the specials registry, or null.
    this.special = null
    // Which player's chain holds it. One player never needs this; two do, and the
    // rules already read it so they will not have to change.
    this.claim = null
  }

  get settled() {
    return this.vy === 0 && this.y === this.row
  }

  // Set the jelly ringing. A bigger impulse takes the axis with it, so the newest
  // and largest event decides which way a dot is squashed.
  nudge(amount, axis = 0) {
    if (Math.abs(amount) >= Math.abs(this.wobble.velocity)) {
      this.wobbleAxis = axis
    }
    this.wobble.velocity += amount
  }

  // How deformed the dot is right now, clamped: past about a third of the radius
  // the shape stops reading as a dot.
  get wobbleAmount() {
    return clamp(this.wobble.value, -CONFIG.WOBBLE_MAX, CONFIG.WOBBLE_MAX)
  }

  // Advance one frame. Returns the speed it landed at, or 0, so the caller can
  // make a noise about it without watching for the transition itself.
  step(dt) {
    let landed = 0
    if (this.y < this.row || this.vy !== 0) {
      this.vy += CONFIG.GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= this.row) {
        this.y = this.row
        landed = this.vy
        if (landed > CONFIG.BOUNCE_FLOOR) {
          this.vy = -landed * CONFIG.BOUNCE
          // Landing stretches the dot sideways, which is a squash onto the floor.
          this.nudge(landed * CONFIG.LAND_SQUASH, 0)
        } else {
          this.vy = 0
        }
      }
    }
    springStep(this.wobble, CONFIG.WOBBLE_STIFFNESS, CONFIG.WOBBLE_DAMPING, dt)
    const target = this.linked ? CONFIG.LINK_SWELL : 0
    this.swell += (target - this.swell) * Math.min(1, CONFIG.LINK_SWELL_RATE * dt)
    return landed
  }
}

export class Board {
  // `pickColour(board, col, row)` lets a mode decide what it deals, which is how
  // the endless mode keeps matches scarce. `specialChance` is the chance a new dot
  // carries a powerup; with none registered it costs nothing.
  constructor({
    cols = 6,
    rows = 6,
    minChain = 2,
    colours = DOT_COLOURS,
    random = Math.random,
    pickColour = null,
    specialChance = 0,
  } = {}) {
    this.cols = cols
    this.rows = rows
    this.minChain = minChain
    this.colours = colours
    this.random = random
    this.pickColour = pickColour
    this.specialChance = specialChance
    this.grid = new Array(cols * rows).fill(null)
    this.dots = []
  }

  // ---- the grid -----------------------------------------------------------
  contains(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows
  }

  at(col, row) {
    return this.contains(col, row) ? this.grid[col + row * this.cols] : null
  }

  put(col, row, dot) {
    this.grid[col + row * this.cols] = dot
    if (dot) {
      dot.col = col
      dot.row = row
    }
  }

  colourAt(col, row) {
    const dot = this.at(col, row)
    return dot ? dot.colour : -1
  }

  get count() {
    return this.dots.length
  }

  get empty() {
    return this.dots.length === 0
  }

  // Every dot has arrived where it belongs, so the board can be judged.
  get settled() {
    for (const dot of this.dots) {
      if (!dot.settled) {
        return false
      }
    }
    return true
  }

  // ---- dealing ------------------------------------------------------------
  #newColour(col, row) {
    if (this.pickColour) {
      return this.pickColour(this, col, row)
    }
    return Math.floor(this.random() * this.colours)
  }

  #newDot(col, row) {
    const dot = new Dot(col, row, this.#newColour(col, row))
    dot.special = dealSpecial(dot.colour, this.specialChance, this.random)
    this.put(col, row, dot)
    this.dots.push(dot)
    return dot
  }

  // A full board, dealt bottom-up so a mode picking a colour can see what is
  // already under and beside a cell.
  fill() {
    this.grid.fill(null)
    this.dots.length = 0
    for (let row = this.rows - 1; row >= 0; row--) {
      for (let col = 0; col < this.cols; col++) {
        this.#newDot(col, row)
      }
    }
    // The whole board drops in, staggered by column and by height.
    for (const dot of this.dots) {
      dot.y = dot.row - this.rows - CONFIG.SPAWN_HEIGHT - dot.col * CONFIG.SPAWN_STAGGER * 0.4
    }
  }

  // An authored board, from a layout written out as one string per row: a digit is
  // a colour (1 for the first, as the original game's level data numbered them) and
  // a dot or a zero is an empty cell.
  //
  // What is written is then allowed to fall, so a layout can be drawn as a shape
  // without every column having to be bottom-aligned by hand. Levels are therefore
  // read as which colours are in which column rather than exactly which cells.
  load(layout) {
    this.grid.fill(null)
    this.dots.length = 0
    for (let row = this.rows - 1; row >= 0; row--) {
      const line = layout[row] || ""
      for (let col = 0; col < this.cols; col++) {
        const char = line[col] ?? "."
        if (char === "." || char === "0") {
          continue
        }
        const dot = new Dot(col, row, Number(char) - 1)
        this.put(col, row, dot)
        this.dots.push(dot)
      }
    }
    this.collapse()
    for (const dot of this.dots) {
      dot.y = dot.row - this.rows - CONFIG.SPAWN_HEIGHT - dot.col * CONFIG.SPAWN_STAGGER * 0.4
    }
  }

  // How many dots of each colour are on the board. What the elimination mode deals
  // from: a colour that has been cleared off the board has a count of zero and is
  // never dealt again.
  colourCounts() {
    const counts = new Array(this.colours).fill(0)
    for (const dot of this.dots) {
      if (dot.colour >= 0 && dot.colour < counts.length) {
        counts[dot.colour]++
      }
    }
    return counts
  }

  // ---- linking ------------------------------------------------------------
  static adjacent(a, b) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1
  }

  // Can this dot start a chain? A dot another player is already holding cannot.
  canStart(dot, player = null) {
    return !!dot && (dot.claim == null || dot.claim === player)
  }

  // Where a chain may go from where it is. `chain` is the dots already in it, in
  // order. The answer is one of:
  //   "extend"   a legal next dot
  //   "retract"  the dot before the last one, so stepping back shortens the chain
  //   null       not a legal move
  linkAction(chain, dot, player = null) {
    if (!dot || chain.length === 0) {
      return null
    }
    const last = chain[chain.length - 1]
    if (chain.length >= 2 && dot === chain[chain.length - 2]) {
      return "retract"
    }
    if (chain.includes(dot)) {
      return null
    }
    if (dot.colour !== chain[0].colour || !Board.adjacent(dot, last)) {
      return null
    }
    if (dot.claim != null && dot.claim !== player) {
      return null
    }
    return "extend"
  }

  // ---- what is left to play ----------------------------------------------
  // A board has a move if a chain as long as the mode demands can be drawn on it.
  // Where that is two, this is the same question as "do any two neighbours match".
  moveAvailable() {
    return this.hasChain(this.minChain)
  }

  // Is there a chain of at least `length` anywhere? A depth-first walk pruned at
  // the length asked for, so this stays cheap however big the board is: the search
  // never goes deeper than it has to.
  hasChain(length) {
    if (length <= 1) {
      return this.dots.length > 0
    }
    const path = []
    const walk = (dot) => {
      path.push(dot)
      if (path.length >= length) {
        path.pop()
        return true
      }
      for (const [dx, dy] of CARDINALS) {
        const next = this.at(dot.col + dx, dot.row + dy)
        if (!next || next.colour !== dot.colour || path.includes(next)) {
          continue
        }
        if (walk(next)) {
          path.pop()
          return true
        }
      }
      path.pop()
      return false
    }
    for (const dot of this.dots) {
      if (walk(dot)) {
        return true
      }
    }
    return false
  }

  // Every adjacent same-colour pair, as [a, b]. Scanning right and down covers
  // each pair once. `limit` stops early, which is all moveAvailable needs.
  matchingPairs(limit = Infinity) {
    const pairs = []
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const dot = this.at(col, row)
        if (!dot) {
          continue
        }
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          const other = this.at(col + dx, row + dy)
          if (other && other.colour === dot.colour) {
            pairs.push([dot, other])
            if (pairs.length >= limit) {
              return pairs
            }
          }
        }
      }
    }
    return pairs
  }

  // The longest chain on the board, as an ordered list of dots, for the hint.
  //
  // This is a longest-path search, which has no shortcut, so it runs on a budget:
  // a board dealt from few colours can hold a same-coloured region big enough that
  // enumerating its paths would stall the frame. Running out of budget returns the
  // best chain found so far, which is a hint either way.
  longestChain(budget = 20000) {
    let best = []
    let steps = budget
    const walk = (dot, path) => {
      if (path.length > best.length) {
        best = path.slice()
      }
      if (--steps <= 0) {
        return
      }
      for (const [dx, dy] of CARDINALS) {
        const next = this.at(dot.col + dx, dot.row + dy)
        if (!next || next.colour !== dot.colour || path.includes(next)) {
          continue
        }
        path.push(next)
        walk(next, path)
        path.pop()
      }
    }
    for (const dot of this.dots) {
      if (steps <= 0) {
        break
      }
      walk(dot, [dot])
    }
    return best
  }

  // ---- board operations ---------------------------------------------------
  // Take these dots off the board. The grid is consistent the moment this
  // returns; collapse and refill are separate so a caller can stagger the
  // animation without the rules waiting on it.
  remove(cells) {
    for (const dot of cells) {
      if (this.at(dot.col, dot.row) === dot) {
        this.put(dot.col, dot.row, null)
      }
      const index = this.dots.indexOf(dot)
      if (index >= 0) {
        this.dots.splice(index, 1)
      }
    }
    return cells
  }

  // Dots that were beside a removed one, so the board can flinch where it was cut.
  neighboursOf(cells) {
    const gone = new Set(cells)
    const touched = new Set()
    for (const dot of cells) {
      for (const [dx, dy] of CARDINALS) {
        const other = this.at(dot.col + dx, dot.row + dy)
        if (other && !gone.has(other)) {
          touched.add(other)
        }
      }
    }
    return [...touched]
  }

  // Close the gaps: everything in a column falls to the lowest free row under it.
  // Only the target row changes here; the fall itself is the dot's own business.
  collapse() {
    for (let col = 0; col < this.cols; col++) {
      let free = this.rows - 1
      for (let row = this.rows - 1; row >= 0; row--) {
        const dot = this.at(col, row)
        if (!dot) {
          continue
        }
        if (row !== free) {
          this.put(col, row, null)
          this.put(col, free, dot)
        }
        free--
      }
    }
  }

  // Top up every column, dealing from the lowest empty cell up so a colour choice
  // can see its neighbours. New dots start above the board and fall in.
  refill() {
    for (let col = 0; col < this.cols; col++) {
      let above = 0
      for (let row = this.rows - 1; row >= 0; row--) {
        if (this.at(col, row)) {
          continue
        }
        const dot = this.#newDot(col, row)
        dot.y = -1 - CONFIG.SPAWN_HEIGHT - above * CONFIG.SPAWN_STAGGER
        above++
      }
    }
  }

  // Force a playable board by recolouring a short run of neighbours to match. This
  // is what keeps the endless mode endless: it deals to avoid matches and then puts
  // exactly one back, of exactly the length the mode needs, when it has dealt
  // itself into a corner. Returns the dots it changed, or null if it changed none.
  ensureMove(length = this.minChain) {
    if (this.moveAvailable() || this.dots.length < length) {
      return null
    }
    // Prefer somewhere in the middle of the board, where a match is harder to spot
    // than one sitting against an edge.
    const candidates = this.dots.filter(
      (dot) => dot.col > 0 && dot.col < this.cols - 1 && dot.row > 0 && dot.row < this.rows - 1,
    )
    const pool = candidates.length > 0 ? candidates : this.dots
    const run = [pool[Math.floor(this.random() * pool.length)]]
    const changed = []
    while (run.length < length) {
      const from = run[run.length - 1]
      const options = CARDINALS.map(([dx, dy]) => this.at(from.col + dx, from.row + dy)).filter(
        (dot) => dot && !run.includes(dot),
      )
      if (options.length === 0) {
        break
      }
      const next = options[Math.floor(this.random() * options.length)]
      next.colour = run[0].colour
      next.special = null
      run.push(next)
      changed.push(next)
    }
    return changed.length > 0 ? changed : null
  }

  // Every dot of one colour. Groundwork for a POP ALL special, and used by a mode
  // that wants to know how a colour is doing.
  cellsOfColour(colour) {
    return this.dots.filter((dot) => dot.colour === colour)
  }

  // Shift a whole column sideways, wrapping at the edges, for a NUDGE special. The
  // dots keep their visual y, so the column slides rather than dropping again.
  nudgeColumn(col, delta) {
    const target = (((col + delta) % this.cols) + this.cols) % this.cols
    if (target === col) {
      return false
    }
    for (let row = 0; row < this.rows; row++) {
      const here = this.at(col, row)
      const there = this.at(target, row)
      this.put(col, row, there)
      this.put(target, row, here)
    }
    return true
  }

  // Advance every dot. `onLand(dot, speed)` is called for each landing, so the
  // caller can voice it.
  step(dt, onLand = null) {
    for (const dot of this.dots) {
      const landed = dot.step(dt)
      if (landed > 0 && onLand) {
        onLand(dot, landed)
      }
    }
  }
}
