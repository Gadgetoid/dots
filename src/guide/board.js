// A board as SVG, for a page rather than a game.
//
// The game draws its board as distance fields in WebGL, which cannot be put in the flow of a
// document, so the guide draws the same board out of elements. Everything that carries meaning
// is taken from the game and not invented here: the palette's colours, the shape each colour
// wears, the dot's radius against its cell, the well it sits in, and the cord the chain is
// drawn with. The one deliberate difference is how loud the shapes are - see SHAPE_BOOST.

import { CONFIG, boardLayout } from "../config.js"
import { DOT_SHAPES, THEMES } from "../palette.js"
import { PUZZLE_COLS, PUZZLE_ROWS } from "../modes/levels.js"
import { TAU } from "../math.js"

const SVG = "http://www.w3.org/2000/svg"

// The guide is the game's dark theme, which is also what the page's own colours are.
export const THEME = THEMES.dark

// One cell, in the units every board here is drawn in. Any number would do; this one keeps
// the numbers in a path readable.
export const CELL = 40

// The game's own proportions, read off a board of the puzzle mode's shape rather than written
// down again: how big a dot is against the cell it sits in, and how the well is drawn round it.
const GAME = boardLayout(PUZZLE_COLS, PUZZLE_ROWS)
export const RADIUS = CELL * (GAME.radius / GAME.cell)
const WELL_PAD = CELL * 0.22
const WELL_CORNER = CELL * 0.5
const EMPTY_DOT = RADIUS * 0.16

// The chain's body is a disc at every dot and a cord between them, all at the dot's own
// radius, so a straight run is no wider than a dot.
const CORD = RADIUS * 2 * CONFIG.CHAIN_CORD_RATIO

// How much louder than the game the shapes are drawn. The board only whispers them, because a
// player has it in front of them; a reader has a picture the size of a paragraph, so the second
// signal has to survive being small.
const SHAPE_BOOST = 1.6
const SHAPE_STEPS = 72

// One id per board on the page, so each board's glow filter is its own.
let serial = 0

export function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value))
  }
  return node
}

export const centreOf = (col, row) => ({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL })

// The outline of a dot, as a path. A circle for a colour whose shape is round, or for a board
// with shapes turned off; otherwise a circle dented in toward a regular polygon, with the corners
// left on the circle so a dot is never bigger than a dot.
//
// The same maths the disc shader uses, angle for angle: `turn` names a direction the polygon has
// an edge across, the dent is deepest there and nothing at all at a corner, and how far to bend is
// divided by the difference that many sides makes, so every shape dents its edges in by the same
// fraction of the radius.
export function dotOutline(colour, radius, shapes) {
  const shape = shapes ? DOT_SHAPES[colour % DOT_SHAPES.length] : null
  if (!shape || shape.sides < 3) {
    const across = radius * 2
    return `M ${-radius} 0 a ${radius} ${radius} 0 1 0 ${across} 0 a ${radius} ${radius} 0 1 0 ${-across} 0 Z`
  }
  const segment = TAU / shape.sides
  const sector = segment / 2
  const strength = CONFIG.SHAPE_STRENGTH * SHAPE_BOOST
  const amount = Math.min(strength / (1 - Math.cos(sector)), 1)
  const points = []
  for (let step = 0; step < SHAPE_STEPS; step++) {
    const angle = (step / SHAPE_STEPS) * TAU
    // The angle to the nearest of the polygon's edges, folded into one sector.
    const across = ((((angle - shape.turn + sector) % segment) + segment) % segment) - sector
    const toward = Math.cos(sector) / Math.cos(across)
    const reach = radius * (1 - amount * (1 - toward))
    points.push(`${(Math.cos(angle) * reach).toFixed(2)} ${(Math.sin(angle) * reach).toFixed(2)}`)
  }
  return `M ${points.join(" L ")} Z`
}

// An empty board: the well, a faint dot in every cell, and the layers a solution is played on.
// The caller fills the layers and owns what goes in them.
export function createBoard(cols, rows, label = "A board of dots") {
  const width = CELL * cols
  const height = CELL * rows
  // Room for the well's padding and for the glow to spill past it.
  const pad = WELL_PAD + RADIUS
  const svg = svgElement("svg", {
    class: "board",
    viewBox: `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`,
    role: "img",
    "aria-label": label,
  })

  const glowId = `chain-glow-${serial++}`
  const defs = svgElement("defs")
  const filter = svgElement("filter", {
    id: glowId,
    x: "-50%",
    y: "-50%",
    width: "200%",
    height: "200%",
  })
  filter.append(svgElement("feGaussianBlur", { stdDeviation: RADIUS * 0.5 }))
  defs.append(filter)

  const well = svgElement("rect", {
    x: -WELL_PAD,
    y: -WELL_PAD,
    width: width + WELL_PAD * 2,
    height: height + WELL_PAD * 2,
    rx: WELL_CORNER,
    fill: THEME.well,
  })

  const cells = svgElement("g", { class: "cells" })
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const at = centreOf(col, row)
      cells.append(svgElement("circle", { cx: at.x, cy: at.y, r: EMPTY_DOT, fill: THEME.cell }))
    }
  }

  // The chain goes under the dots, which are the same colour, so the two never read as two
  // shapes overlapping. The floaters go over everything.
  const chain = createChain(glowId)
  const dots = svgElement("g", { class: "dots" })
  const floaters = svgElement("g", { class: "floaters" })
  svg.append(defs, well, cells, chain.group, dots, floaters)

  return { svg, cols, rows, chain, dots, floaters }
}

// The chain, as two copies of one polyline: a blurred one for the light it throws and a solid
// one over the top. The glow layer is what the game's bloom pass does with it.
function createChain(glowId) {
  const group = svgElement("g", { class: "chain" })
  const shared = {
    fill: "none",
    "stroke-width": CORD,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }
  const glow = svgElement("polyline", { ...shared, class: "chain-glow", filter: `url(#${glowId})` })
  const body = svgElement("polyline", { ...shared, class: "chain-body" })
  group.append(glow, body)

  // Draw the chain through these cells, in the colour of the dots it holds. Fewer than two and
  // there is no cord to draw: a single linked dot is only itself, brightened.
  const show = (cells, colour) => {
    if (cells.length < 2) {
      hide()
      return
    }
    const points = cells
      .map((cell) => {
        const at = centreOf(cell.col, cell.row)
        return `${at.x},${at.y}`
      })
      .join(" ")
    const bright = THEME.dots[colour % THEME.dots.length].bright
    for (const line of [glow, body]) {
      line.setAttribute("points", points)
      line.setAttribute("stroke", bright)
    }
    group.style.opacity = "1"
  }
  const hide = () => {
    group.style.opacity = "0"
    for (const line of [glow, body]) {
      line.removeAttribute("points")
    }
  }
  hide()
  return { group, show, hide }
}

// One dot, as an element. The body is a child of the group so a dot can be swelling or popping
// while the group is falling, without the two transforms fighting over the same attribute.
export function createDot(colour, shapes) {
  const group = svgElement("g", { class: "dot" })
  const body = svgElement("path", {
    d: dotOutline(colour, RADIUS, shapes),
    fill: THEME.dots[colour % THEME.dots.length].base,
  })
  group.append(body)
  return { group, body, colour }
}

export function placeDot(dot, col, row, animate) {
  const at = centreOf(col, row)
  dot.group.classList.toggle("falling", animate === true)
  dot.group.setAttribute("transform", `translate(${at.x} ${at.y})`)
}

// A dot in a chain: the bright variant of its colour, and swollen by as much as the game swells
// one, which is how a chain reads as picking dots up.
export function linkDot(dot, linked) {
  const colours = THEME.dots[dot.colour % THEME.dots.length]
  dot.body.setAttribute("fill", linked ? colours.bright : colours.base)
  dot.body.style.transform = linked ? `scale(${1 + CONFIG.LINK_SWELL})` : ""
}

// One dot on its own, at the size of a line of text: the key that says which shape goes with
// which colour.
export function dotChip(colour, shapes) {
  const box = RADIUS * 2.3
  const svg = svgElement("svg", {
    class: "chip",
    viewBox: `${-box / 2} ${-box / 2} ${box} ${box}`,
    "aria-hidden": "true",
  })
  svg.append(
    svgElement("path", {
      d: dotOutline(colour, RADIUS, shapes),
      fill: THEME.dots[colour % THEME.dots.length].base,
    }),
  )
  return svg
}

// What a chain was worth, rising off the dot in the middle of it, as the game's floaters do.
export function floatScore(board, cell, text, colour) {
  const at = centreOf(cell.col, cell.row)
  const label = svgElement("text", {
    class: "floater",
    x: at.x,
    y: at.y,
    "text-anchor": "middle",
    fill: THEME.dots[colour % THEME.dots.length].bright,
  })
  label.textContent = text
  board.floaters.append(label)
  label.addEventListener("animationend", () => label.remove())
  return label
}
