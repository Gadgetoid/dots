// The strategy guide's tables, figures and solutions.
//
// The page holds the writing and this holds the numbers, taken from the game rather than written
// down again: the scoring from CONFIG, the modes from the mode list, the levels from the level
// file, the colours and shapes from the palette, the sounds from the audio engine, and the
// solutions from what tools/verify-levels.mjs proved about each board.

import { CONFIG } from "../config.js"
import { GAME_MODES } from "../modes/index.js"
import { PUZZLE } from "../modes/puzzle.js"
import { LEVELS, PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { analyse } from "../analysis.js"
import { movesFrom, parse, unpack, coloursIn, EMPTY } from "../solver.js"
import { buildTuning, resolveTuning } from "../scales.js"
import { Sound } from "../audio.js"
import { createBoard, createDot, placeDot, linkDot, dotChip, THEME } from "./board.js"
import { createSolution } from "./solution.js"
import {
  SCORING,
  provedBoards,
  provenFor,
  replay,
  createSolver,
  cellName,
  colourName,
  COLOUR_NAMES,
  shapeOf,
} from "./routes.js"

// Every board on the page, so the shapes toggle reaches all of them at once.
const boards = []

// Whether the reader has asked for less movement. Nothing plays by itself if so, and the page's
// own stylesheet takes the transitions out from under what does.
const stillness = window.matchMedia("(prefers-reduced-motion: reduce)")

const number = (value) => value.toLocaleString("en-GB")

function html(tag, className, text) {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text != null) {
    node.textContent = text
  }
  return node
}

function fill(id, ...children) {
  const host = document.getElementById(id)
  if (host) {
    host.replaceChildren(...children)
  }
  return host
}

// A table from a list of headings and a list of rows. A cell is either text or an element, and a
// heading given as `{ label, numeric }` sets its whole column to the right.
function table(headings, rows) {
  const node = html("table")
  const head = html("thead")
  const headRow = html("tr")
  for (const heading of headings) {
    const cell = html("th", heading.numeric ? "numeric" : null, heading.label ?? heading)
    headRow.append(cell)
  }
  head.append(headRow)
  const body = html("tbody")
  for (const row of rows) {
    const line = html("tr")
    for (const [index, value] of row.entries()) {
      const cell = html("td", headings[index]?.numeric ? "numeric" : null)
      if (value instanceof Node) {
        cell.append(value)
      } else {
        cell.textContent = value
      }
      line.append(cell)
    }
    body.append(line)
  }
  node.append(head, body)
  return node
}

// ---- boards on the page ---------------------------------------------------
// Every figure is drawn on the same grid: as wide as the game's board and tall enough for the
// tallest of them, so the figures are all one size and read as pieces of a real board. A layout
// short of that is padded with empty rows above it, which is where the empty rows of a real board
// are once it has fallen.
const FIGURE_ROWS = 4
const figure = (layout) => [
  ...Array(FIGURE_ROWS - layout.length).fill(".".repeat(PUZZLE_COLS)),
  ...layout,
]

// A board with nothing happening on it: a layout, dealt, with one chain drawn over it. What a
// figure in the text needs, as against a solution, which moves.
function stillBoard(layout, cols, rows, chainCells, label) {
  const board = createBoard(cols, rows, label)
  const grid = unpack(parse(layout, cols, rows), cols, rows)
  const draw = (shapes) => {
    board.dots.replaceChildren()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const colour = grid[col + row * cols]
        if (colour === EMPTY) {
          continue
        }
        const dot = createDot(colour, shapes)
        placeDot(dot, col, row, false)
        const inChain = chainCells.some((cell) => cell.col === col && cell.row === row)
        if (inChain) {
          linkDot(dot, true)
        }
        board.dots.append(dot.group)
      }
    }
    if (chainCells.length > 0) {
      const first = chainCells[0]
      board.chain.show(chainCells, grid[first.col + first.row * cols])
    }
  }
  boards.push({ setShapes: draw })
  draw(shapesOn())
  return board.svg
}

const shapesOn = () => document.getElementById("shapes")?.checked !== false

// The five colours, and the same five with the shapes setting on. Both rows whatever the toggle at
// the top of the page says, since this is the figure that shows what the setting does.
function paletteKey() {
  const key = document.getElementById("palette-key")
  if (!key) {
    return
  }
  key.replaceChildren()
  for (const [label, shapes] of [
    ["colour", false],
    ["with shapes", true],
  ]) {
    key.append(html("i", null, label))
    for (const colour of COLOUR_NAMES.keys()) {
      key.append(dotChip(colour, shapes))
    }
  }
  key.append(html("i", null, ""))
  for (const name of COLOUR_NAMES) {
    key.append(html("span", null, name))
  }
}

// The longest chain a layout offers, as cells. movesFrom hands its chains back longest first, so
// this is the first of them: the most any single pop on this board could take.
function longestChain(layout, cols, rows) {
  const { moves } = movesFrom(parse(layout, cols, rows), cols, rows, PUZZLE.minChain)
  const cells = moves[0] ?? []
  return cells.map((cell) => ({ col: cell % cols, row: Math.floor(cell / cols) }))
}

// ---- what a chain is worth ------------------------------------------------
function cubes() {
  const rows = []
  for (let length = PUZZLE.minChain; length <= 8; length++) {
    const scored = CONFIG.chainScore(length)
    const before = CONFIG.chainScore(length - 1)
    rows.push([
      `${length} dots`,
      number(scored),
      `+${number(scored - before)}`,
      length >= CONFIG.MULTIPLIER_CHAIN ? "yes" : "no",
    ])
  }
  fill(
    "cube-table",
    table(
      [
        "chain",
        { label: "worth", numeric: true },
        { label: "for the last dot", numeric: true },
        "banks a multiplier",
      ],
      rows,
    ),
  )

  // The same six dots, taken as one chain and taken in pieces.
  const whole = CONFIG.chainScore(6)
  const halves = CONFIG.chainScore(3) * 2
  const pairs = CONFIG.chainScore(2) * 3
  fill(
    "cube-arithmetic",
    html(
      "p",
      null,
      `Six in a row pay ${number(whole)} together, ${number(halves)} as two threes and ` +
        `${number(pairs)} as three pairs. Neither split banks a multiplier either.`,
    ),
  )
  const row = figure(["111111"])
  fill(
    "cube-board",
    stillBoard(
      row,
      PUZZLE_COLS,
      FIGURE_ROWS,
      longestChain(row, PUZZLE_COLS, FIGURE_ROWS),
      "Six dots in a row, linked as one chain",
    ),
  )
}

// ---- the multiplier -------------------------------------------------------
function multiplier() {
  const rows = []
  let banked = 1
  let patient = 0
  for (let chain = 1; chain <= CONFIG.MULTIPLIER_MAX; chain++) {
    const scored = CONFIG.chainScore(CONFIG.MULTIPLIER_CHAIN) * banked
    patient += scored
    rows.push([`chain ${chain}`, `x${banked}`, number(scored), number(patient)])
    banked = SCORING.multiplierAfter(banked, CONFIG.MULTIPLIER_CHAIN)
  }
  fill(
    "multiplier-table",
    table(
      [
        "",
        "in hand",
        { label: `a chain of ${CONFIG.MULTIPLIER_CHAIN} pays`, numeric: true },
        { label: "running total", numeric: true },
      ],
      rows,
    ),
  )

  // The same chains with a pair dropped in between each, which puts the multiplier back every
  // time. Same dots off the board, a fraction of the score.
  const flat =
    CONFIG.MULTIPLIER_MAX *
    (CONFIG.chainScore(CONFIG.MULTIPLIER_CHAIN) + CONFIG.chainScore(PUZZLE.minChain))
  fill(
    "multiplier-cost",
    html(
      "p",
      null,
      `Those ${CONFIG.MULTIPLIER_MAX} chains pay ${number(patient)}. With a pair spent between ` +
        `each one they pay ${number(flat)}.`,
    ),
  )
}

// ---- the sounds -----------------------------------------------------------
// How far the cursor tone counts, which is the cap on Board.reachFrom. A default parameter cannot
// be read from out here, so it is written down and the number in the text comes off it.
const REACH_CAP = 10

// The game's own audio engine, playing the game's own cues. Nothing is sampled or described: the
// button calls the same method the board calls.
function sounds() {
  const tuning = buildTuning(PUZZLE.tuning)
  let ready = false
  const start = () => {
    if (ready) {
      return
    }
    // A browser will not open an audio device outside a user gesture, and a button press is one.
    Sound.gestured = true
    Sound.enabled = true
    Sound.setTuning(tuning)
    Sound.ensureContext()
    ready = true
  }

  const run = (steps) => {
    for (const [at, step] of steps.entries()) {
      setTimeout(step, at * 180)
    }
  }

  const CUES = [
    {
      label: "nothing here",
      say: "a dot that starts nothing",
      play: () => Sound.cursor(PUZZLE.minChain - 1, PUZZLE.minChain),
    },
    {
      label: "a pair",
      say: "a dot that could reach two",
      play: () => Sound.cursor(2, PUZZLE.minChain),
    },
    {
      label: "four",
      say: "three steps further up",
      play: () => Sound.cursor(4, PUZZLE.minChain),
    },
    {
      label: "seven",
      say: "past the top of the scale and into the next octave",
      play: () => Sound.cursor(7, PUZZLE.minChain),
    },
    {
      label: `${REACH_CAP} or more`,
      say: "as high as it counts",
      play: () => Sound.cursor(REACH_CAP, PUZZLE.minChain),
    },
    {
      label: "linking five",
      say: "a step up per dot",
      play: () => run([0, 1, 2, 3, 4].map((index) => () => Sound.link(index))),
    },
    {
      label: "popping five",
      say: "the same run, unzipping",
      play: () => {
        for (let index = 0; index < 5; index++) {
          Sound.pop(index, index * CONFIG.POP_STAGGER)
        }
      },
    },
    {
      label: "a multiplier banked",
      say: "an octave over the run that earned it",
      play: () => Sound.multiplier(2),
    },
    {
      label: "refused",
      say: "not a note in the scale",
      play: () => Sound.blocked(),
    },
    {
      label: "dropped",
      say: "a chain let go unspent",
      play: () => Sound.cancel(),
    },
    {
      label: "cleared",
      say: "a run up the scale",
      play: () => Sound.clear(),
    },
    {
      label: "nothing left",
      say: "two notes an octave down",
      play: () => Sound.fail(),
    },
  ]

  const list = html("div", "cues")
  for (const cue of CUES) {
    const button = html("button", "cue")
    button.type = "button"
    button.append(html("b", null, cue.label), html("i", null, cue.say))
    button.addEventListener("click", () => {
      start()
      cue.play()
    })
    list.append(button)
  }
  fill("cues", list)

  fill("reach-cap", document.createTextNode(String(REACH_CAP)))
  fill(
    "tuning",
    html(
      "p",
      "aside",
      `Tuned as Puzzle is: ${tuning.name.toLowerCase()} rooted at ${tuning.root}. Every mode has ` +
        `its own voice.`,
    ),
  )
}

// ---- the hint -------------------------------------------------------------
function hint() {
  fill(
    "hint-timing",
    html(
      "p",
      null,
      `${CONFIG.HINT_DELAY} seconds on a settled board and the dots of the longest chain on it ` +
        `wobble, again every ${CONFIG.HINT_REPEAT} seconds after that. A chain in hand stops the ` +
        `clock.`,
    ),
  )
}

// ---- the traps ------------------------------------------------------------
// Each of these is a real board, with the numbers in what is said about it measured off it: how
// many dots the biggest run of one colour holds, how many of them a chain can take, and what the
// best and worst clearing orders pay.
function traps() {
  const list = html("div", "traps")
  const board = (layout, chain, label) => stillBoard(layout, PUZZLE_COLS, FIGURE_ROWS, chain, label)
  const judge = (layout) =>
    analyse(layout, PUZZLE_COLS, FIGURE_ROWS, PUZZLE.minChain, SCORING, { seconds: 2 })

  const plus = figure(["..1...", ".111..", ".212.."])
  const plusChain = longestChain(plus, PUZZLE_COLS, FIGURE_ROWS)
  const plusRegion = judge(plus).biggestRegion
  list.append(
    trap(
      "The plus",
      board(plus, plusChain, "A plus of five dots with a chain of three drawn through it"),
      `${plusRegion} touching dots, and a chain can take ${plusChain.length} of them: ` +
        `${number(CONFIG.chainScore(plusChain.length))} instead of ` +
        `${number(CONFIG.chainScore(plusRegion))}. A dot with three neighbours strands the ones ` +
        `behind it.`,
    ),
  )

  const stairs = figure(["....1.", "...12.", "..123.", ".1234."])
  const stairsMoves = movesFrom(
    parse(stairs, PUZZLE_COLS, FIGURE_ROWS),
    PUZZLE_COLS,
    FIGURE_ROWS,
    PUZZLE.minChain,
  ).moves.length
  list.append(
    trap(
      "The staircase",
      board(stairs, [], "A staircase of dots with no legal chain on it"),
      `Diagonals are not neighbours. Ten dots here, ${stairsMoves} moves.`,
    ),
  )

  const sandwich = figure(["..11..", "..22..", "..11.."])
  const judged = judge(sandwich)
  list.append(
    trap(
      "The sandwich",
      board(
        sandwich,
        [
          { col: 2, row: 2 },
          { col: 3, row: 2 },
        ],
        "Four purple dots split by a blue pair, with the blue pair linked",
      ),
      `Take the purple pairs as they lie for ${number(judged.floor)}. Pop the blue pair first and ` +
        `they fall together into a run of four: ${number(judged.par)}.`,
    ),
  )

  const orphan = figure(["31122."])
  const alone = [...coloursIn(parse(orphan, PUZZLE_COLS, FIGURE_ROWS)).entries()]
    .filter(([, count]) => count < PUZZLE.minChain)
    .map(([colour]) => colourName(colour))
  list.append(
    trap(
      "The orphan",
      board(orphan, [], "Five dots, one of them the only one of its colour"),
      `One ${alone.join(" and ")} dot and no other. Nothing refills, so this board is already lost.`,
    ),
  )

  fill("trap-demos", list)
}

function trap(title, svg, note) {
  const figure = html("figure", "trap")
  const stage = html("div", "stage")
  stage.append(svg)
  const caption = html("figcaption")
  caption.append(html("h3", null, title), html("p", null, note))
  figure.append(stage, caption)
  return figure
}

// ---- what the collapse does to a whole level ------------------------------
// How often the obvious play is wrong, over the shipped ladder, from what has already been proved
// about each board.
function collapse(proved) {
  const known = LEVELS.map((level) => provenFor(proved, level)).filter(Boolean)
  if (known.length === 0) {
    fill(
      "greed-stats",
      html("p", "aside", "Nothing has been proved about the levels on this copy."),
    )
    return
  }
  const strands = known.filter((board) => board.greedy === "strands").length
  const short = known.filter((board) => board.greedy !== "strands" && board.greedy < board.par)
  const pays = known.length - strands - short.length
  const openings = known.reduce((sum, board) => sum + board.firstMoves, 0)
  const silent = known.reduce((sum, board) => sum + board.firstSilent, 0)
  const forced = known.filter((board) => board.par === board.floor).length
  const only = known.filter((board) => board.parPaths === 1).length

  fill(
    "greed-stats",
    html(
      "p",
      null,
      `It strands ${strands} of the ${known.length} levels outright, clears ${short.length} for less ` +
        `than par, and pays par on ${pays}. Of the ${number(openings)} opening moves across the ` +
        `ladder, ${number(silent)} lose the level while leaving a board that still looks matchable: ` +
        `no orphan to spot and no way back. ${only} levels have exactly one order that pays par, and ` +
        `${forced} pay the same whatever you do.`,
    ),
  )
}

// The most tempting version of it, on a real level: the longest chain on the board, beside the
// chain par opens with. Whichever stranding level offers the longest opening chain, so the figure
// follows the levels rather than naming one.
function greedIllustration(proved) {
  let worst = null
  for (const [index, level] of LEVELS.entries()) {
    const board = provenFor(proved, level)
    if (!board?.route || board.greedy !== "strands") {
      continue
    }
    const greedy = longestChain(level.layout, PUZZLE_COLS, PUZZLE_ROWS)
    if (!worst || greedy.length > worst.greedy.length) {
      worst = { index, level, board, greedy }
    }
  }
  if (!worst) {
    return
  }

  const par = worst.board.route[0].map(([col, row]) => ({ col, row }))
  const grid = unpack(parse(worst.level.layout, PUZZLE_COLS, PUZZLE_ROWS), PUZZLE_COLS, PUZZLE_ROWS)
  const colourAt = (cells) => colourName(grid[cells[0].col + cells[0].row * PUZZLE_COLS])
  const figure = html("div", "compare")
  figure.append(
    beside(
      stillBoard(
        worst.level.layout,
        PUZZLE_COLS,
        PUZZLE_ROWS,
        worst.greedy,
        `${worst.level.name}, with the longest chain on the board drawn`,
      ),
      `${worst.greedy.length} ${colourAt(worst.greedy)} for ` +
        `${number(CONFIG.chainScore(worst.greedy.length))}, and the level cannot be cleared after it`,
    ),
    beside(
      stillBoard(
        worst.level.layout,
        PUZZLE_COLS,
        PUZZLE_ROWS,
        par,
        `${worst.level.name}, with the opening chain of a par order drawn`,
      ),
      `${par.length} ${colourAt(par)} for ${number(CONFIG.chainScore(par.length))}, on the way to ` +
        `par ${number(worst.level.par)}`,
    ),
  )
  fill(
    "greed-boards",
    html("p", null, `Level ${worst.index + 1}, ${worst.level.name}, both openings:`),
    figure,
  )
}

function beside(svg, note) {
  const figure = html("figure")
  const stage = html("div", "stage")
  stage.append(svg)
  figure.append(stage, html("figcaption", null, note))
  return figure
}

// ---- short chains as a setup ----------------------------------------------
// What the par orders actually do with the multiplier: how many of them spend a chain too short to
// bank, and what that buys.
function setups(proved) {
  const routes = LEVELS.map((level) => provenFor(proved, level)?.route).filter(Boolean)
  if (routes.length === 0) {
    return
  }
  const lengths = routes.map((route) => route.map((chain) => chain.length))
  const sets = lengths.filter((route) =>
    route.some(
      (length, at) =>
        length < CONFIG.MULTIPLIER_CHAIN &&
        route.slice(at + 1).some((later) => later >= CONFIG.MULTIPLIER_CHAIN),
    ),
  ).length
  const highest = Math.max(
    ...lengths.map((route) =>
      route.reduce((multiplier, length) => SCORING.multiplierAfter(multiplier, length), 1),
    ),
  )
  fill(
    "multiplier-setup",
    html(
      "p",
      "aside",
      `${sets} of the ${routes.length} par orders below spend a chain too short to bank before a ` +
        `longer one, and the best of them finish holding x${highest}.`,
    ),
  )
}

// ---- the modes ------------------------------------------------------------
const MODE_TIPS = {
  classic:
    "Nothing can be lost while a move exists, so the only thing to play for is length. Walk the cursor about before committing: a chain costs nothing until you pop it.",
  rush: "The clock beats the perfect chain. Keep taking fours so the multiplier climbs, and let the sixes go if you have to hunt for them.",
  "long-game":
    "A pair is not a move, so two touching dots of one colour sit there as a join until the collapse brings a third along.",
  endless:
    "The board is dealt to hide its matches rather than to run out of them, so there is always something. Sweep the cursor and listen: the tone tells you what is there before you have finished reading the colours.",
  elimination:
    "Every colour taken off the board narrows what the rest of the game deals, which makes the board simpler and the chains shorter. Bank the multiplier while there are still five colours to work with.",
  "clear-out":
    "Most dealt boards cannot be emptied at all, so play for the fewest dots left rather than for none. Spend the awkward colours first, while there are still dots to move them with.",
  puzzle:
    "Read the whole board before the first pop: par is one particular order, and the collapse decides which orders exist. When you are stuck, ask which colour is furthest from being joined up and work back from it.",
}

function modes() {
  const rows = GAME_MODES.map((mode) => {
    const tuning = resolveTuning(mode.tuning)
    const detail = html("div")
    detail.append(html("b", null, mode.name), html("i", null, MODE_TIPS[mode.id] ?? mode.blurb))
    return [
      detail,
      `${mode.cols}x${mode.rows}`,
      String(mode.minChain),
      mode.refill === false ? "never" : typeof mode.refill === "function" ? "while it can" : "yes",
      mode.timeLimit > 0 ? `${mode.timeLimit}s` : "-",
      mode.tuning === "random" ? "a different one each session" : tuning.name.toLowerCase(),
    ]
  })
  fill(
    "mode-table",
    table(
      ["mode", "board", { label: "min chain", numeric: true }, "refills", "clock", "voice"],
      rows,
    ),
  )
}

// ---- the ladder -----------------------------------------------------------
function ladder(proved) {
  const rows = LEVELS.map((level, index) => {
    const board = provenFor(proved, level)
    const { dots, colours } = shapeOf(level)
    const star = board ? (board.par === board.floor ? "-" : "yes") : "?"
    return [
      String(index + 1),
      level.name,
      `${dots} in ${colours}`,
      number(level.par),
      number(level.floor),
      star,
      board ? bar(board.band) : "?",
      board ? String(board.parPaths) : "?",
      board ? (board.greedy === "strands" ? "strands" : number(board.greedy)) : "?",
    ]
  })
  fill(
    "ladder-table",
    table(
      [
        { label: "#", numeric: true },
        "level",
        "dots",
        { label: "par", numeric: true },
        { label: "floor", numeric: true },
        "star",
        "hard",
        { label: "par orders", numeric: true },
        { label: "greed pays", numeric: true },
      ],
      rows,
    ),
  )
}

// A difficulty band as something to skim down a column: the game's picker draws the same number
// of marks.
const bar = (band) => "*".repeat(band).padEnd(5, ".")

// ---- the solutions --------------------------------------------------------
// One order that scores par for every level, behind a spoiler each, and built only when a reader
// opens one: a board is a hundred elements and there is no sense in laying out thirty-six of them
// for a page most readers will stop above.
function solutions(proved) {
  const solver = createSolver()
  const list = html("div", "solutions")

  for (const [index, level] of LEVELS.entries()) {
    const spoiler = html("details", "solution")
    const summary = html("summary")
    summary.append(
      html("b", null, `${index + 1}. ${level.name}`),
      html("span", null, `par ${number(level.par)}`),
    )
    const body = html("div", "solution-body")
    spoiler.append(summary, body)
    list.append(spoiler)

    let built = false
    spoiler.addEventListener("toggle", async () => {
      if (!spoiler.open || built) {
        return
      }
      built = true
      body.append(html("p", "working", "working out an order that scores par..."))
      const route = await routeFor(proved, level, index, solver)
      body.replaceChildren(...(route ? solved(level, route) : [failed()]))
    })
  }

  fill("solution-list", list)
}

// The route to show: what has been proved about this board if the file covers it, and otherwise
// whatever a worker can work out here and now.
async function routeFor(proved, level, index, solver) {
  const board = provenFor(proved, level)
  if (board?.route) {
    const played = replay(level, board.route)
    if (played && played.cleared) {
      return { ...played, par: played.score === level.par, from: "proved" }
    }
  }
  const found = await solver.solve(index)
  if (!found?.route) {
    return null
  }
  const played = replay(level, found.route)
  if (!played || !played.cleared) {
    return null
  }
  return { ...played, par: played.score === level.par, from: "here" }
}

function solved(level, route) {
  // The board is built last, since it reports its state as soon as it exists and the readout it
  // reports into has to be there to hear it.
  let player = null

  const readout = html("p", "readout")
  const controls = html("div", "controls")
  const play = button("play", () => player.toggle())
  controls.append(
    play,
    button("step", () => player.step()),
    button("back", () => player.back()),
    button("restart", () => player.restart()),
  )

  const steps = html("ol", "steps")
  for (const move of route.moves) {
    const line = html("li")
    line.append(
      html(
        "span",
        "what",
        `${move.cells.length} ${colourName(move.colour)}, ${move.cells.map(cellName).join(" ")}`,
      ),
      html(
        "span",
        "paid",
        `+${number(move.scored)}${move.multiplier > 1 ? ` (x${move.multiplier})` : ""}`,
      ),
    )
    steps.append(line)
  }

  const draw = (state) => {
    const at = Math.min((state.showing ?? state.move) + 1, state.moves)
    readout.textContent =
      `move ${at} of ${state.moves} - ${number(state.score)} of ${number(route.score)} ` +
      `- x${state.multiplier} in hand`
    play.textContent = state.running ? "pause" : state.finished ? "again" : "play"
    for (const [index, line] of [...steps.children].entries()) {
      line.classList.toggle("now", index === state.showing)
      line.classList.toggle("done", index < state.move)
    }
  }

  player = createSolution(level, route.moves, { shapes: shapesOn(), onState: draw })
  boards.push(player)
  const stage = html("div", "stage")
  stage.append(player.svg)

  if (!stillness.matches) {
    player.play()
  }

  const caption = html("div", "solution-notes")
  caption.append(readout, controls, steps)
  // Only where the order shown is not one that pays par, which is what a board this page had to
  // work out for itself may come back with.
  if (!route.par) {
    caption.append(
      html(
        "p",
        "proof",
        `This order clears the level for ${number(route.score)}, short of par ${number(level.par)}.`,
      ),
    )
  }
  return [stage, caption]
}

const failed = () =>
  html(
    "p",
    "aside",
    "No order could be worked out for this level here, which should not happen: the level test " +
      "proves every shipped level can be cleared. Check the console.",
  )

function button(label, onClick) {
  const node = html("button", null, label)
  node.type = "button"
  node.addEventListener("click", onClick)
  return node
}

// ---- the page -------------------------------------------------------------
async function main() {
  document.getElementById("shapes")?.addEventListener("change", (event) => {
    for (const board of boards) {
      board.setShapes(event.target.checked)
    }
  })

  fill("level-count", document.createTextNode(String(LEVELS.length)))
  document.documentElement.style.setProperty("--accent", THEME.accent)

  paletteKey()
  cubes()
  multiplier()
  sounds()
  hint()
  traps()
  modes()

  // Everything above is worked out from the code alone. What is left needs the file of proved
  // boards, which is fetched, so it lands a moment later.
  const proved = await provedBoards()
  setups(proved)
  collapse(proved)
  greedIllustration(proved)
  ladder(proved)
  solutions(proved)
}

main()
