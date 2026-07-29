// Drawing. Everything the player sees is decided here and issued as renderer
// primitives in view space; the game holds no drawing state and the renderer holds
// no game state.
//
// Painter order matters: the well, then the empty cells, then the chain, then the
// dots over it, then the particles, then a curtain over the strip above the board
// where refilled dots are still falling in, and the HUD and any menu over that.

import { VIEW_W, VIEW_H, CONFIG, cellCentre } from "./config.js"
import { PHASE } from "./game.js"
import { THEMES } from "./palette.js"
import { clamp, easeOutCubic, lerp } from "./math.js"

// The strip under the board, which holds the pause button and anything the board
// has to say for itself.
const HUD_BOTTOM = VIEW_H - 74

const TITLE = "Dots"

// What a finished board is told it did.
const OUTCOMES = {
  lost: "No moves left",
  timeup: "Time up",
  won: "Board cleared",
}

// A button in the mode grid, and the gap between them. Big enough to be an obvious
// target for a thumb, which is the whole reason the modes are a grid and not a list.
const GRID_CELL_H = 48
const GRID_GAP = 8

// The pause button, in the strip under the board. A touch player has no escape key,
// so this is the only way into the menu for them, and it is where a thumb already is.
const PAUSE_BUTTON = { w: 46, h: 34, x: VIEW_W - 28 - 46, y: HUD_BOTTOM - 4 }

export class GameView {
  constructor(renderer) {
    this.renderer = renderer
    // Kept so a resize can be recomputed without the caller having to hold it.
    this.rect = { width: 0, height: 0 }
    // Where each menu row was drawn this frame, so a tap can find it. Recorded by
    // the drawing rather than worked out twice: the layout is only written once.
    this.menuHits = []
  }

  // Which menu row a point in view space is over, and which of its options if it is a
  // row of them, or null. Options are recorded before rows, so the more specific hit
  // wins.
  menuRowAt(x, y) {
    for (const hit of this.menuHits) {
      if (x >= hit.x && y >= hit.y && x <= hit.x + hit.w && y <= hit.y + hit.h) {
        return { index: hit.index, option: hit.option ?? null }
      }
    }
    return null
  }

  // Is this point on the pause button? Only while it is drawn, which is while a board
  // is being played.
  pauseButtonAt(x, y) {
    if (!this.pauseVisible) {
      return false
    }
    const box = PAUSE_BUTTON
    return x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h
  }

  // Fit the fixed field into the canvas, letterboxing whatever is left over.
  resize(rect) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = this.renderer.canvas
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H)
    const width = VIEW_W * scale
    const height = VIEW_H * scale
    this.rect = { width: rect.width, height: rect.height, scale }
    this.content = {
      x: (rect.width - width) / 2,
      y: (rect.height - height) / 2,
      width,
      height,
    }
    this.renderer.setContentRect(this.content.x, this.content.y, width, height, dpr)
  }

  // Where a canvas-space pointer lands in view space, or null if it is in the
  // letterbox. Touch input comes through here, so it has to be exact.
  toViewSpace(clientX, clientY) {
    const bounds = this.renderer.canvas.getBoundingClientRect()
    const content = this.content
    if (!content) {
      return null
    }
    const x = ((clientX - bounds.left - content.x) / content.width) * VIEW_W
    const y = ((clientY - bounds.top - content.y) / content.height) * VIEW_H
    if (x < 0 || y < 0 || x > VIEW_W || y > VIEW_H) {
      return null
    }
    return { x, y }
  }

  render(game) {
    const renderer = this.renderer
    const theme = game.theme
    renderer.brightness = game.brightness.value
    renderer.glowIntensity = CONFIG.BLOOM_INTENSITY * theme.bloom
    // A dark field takes a vignette well and a white one only looks dirty.
    renderer.vignette = theme.id === "dark" ? 0.55 : 0
    renderer.beginFrame(game.time)
    renderer.clearFrame(theme.background)

    if (game.board) {
      this.#drawWell(game, theme)
      this.#drawChains(game, theme)
      this.#drawDots(game, theme)
      this.#drawParticles(game)
      this.#drawCursors(game, theme)
      this.#drawCurtain(game, theme)
    }
    this.#drawHud(game, theme)
    this.#drawFloaters(game)
    if (game.page) {
      this.#drawMenu(game, theme)
    } else {
      this.menuHits.length = 0
    }
    renderer.endFrame()
  }

  // ---- the board ----------------------------------------------------------
  #drawWell(game, theme) {
    const layout = game.layout
    const pad = layout.cell * 0.22
    this.renderer.panel(
      layout.x - pad,
      layout.y - pad,
      layout.width + pad * 2,
      layout.height + pad * 2,
      { fill: theme.well, radius: layout.cell * 0.5 },
    )
    // A faint dot in every cell, so the grid is legible with nothing on it - which
    // is most of what the clear-out mode looks like by the end.
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (game.board.at(col, row)) {
          continue
        }
        const at = cellCentre(layout, col, row)
        this.renderer.disc(at.x, at.y, layout.radius * 0.16, { color: theme.cell })
      }
    }
  }

  #drawDots(game, theme) {
    const layout = game.layout
    for (const dot of game.board.dots) {
      const at = game.dotPosition(dot)
      const colours = theme.dots[dot.colour % theme.dots.length]
      const linked = dot.linked
      const radius = layout.radius * (1 + dot.swell)
      this.renderer.disc(at.x, at.y, radius, {
        color: linked ? colours.bright : colours.base,
        // A dot in the chain shows only a little of its wobble: the rest of the chain
        // is not deforming with it, and a dot squashing hard inside one body reads as
        // a dent in it.
        wobble: {
          amount: dot.wobbleAmount * (linked ? CONFIG.WOBBLE_LINKED : 1),
          axis: dot.wobbleAxis,
        },
        // A dot at rest is a bead and is lit like one. A linked one is part of the
        // chain's single unbroken shape, and a highlight on each would show through
        // it as a row of patches.
        sheen: linked ? 0 : theme.id === "dark" ? 0.18 : 0.1,
        // A linked dot is inside the chain's own body, which is what glows: lighting
        // it again here only doubles the light in the same place.
        glow: 0,
      })
    }
    // A dot on its way out shrinks into its own burst.
    for (const going of game.popping) {
      if (going.burst) {
        continue
      }
      const fade = clamp(going.at / CONFIG.POP_STAGGER / 2, 0, 1)
      const colours = theme.dots[going.colour % theme.dots.length]
      this.renderer.disc(going.x, going.y, layout.radius * (0.6 + 0.4 * fade), {
        color: colours.bright,
        alpha: 0.5 + 0.5 * fade,
        glow: 0.6,
      })
    }
  }

  // The chain, as one body: a disc at every dot and a cord between them, filleted
  // together by the shader so the dots reach out to each other and a right-angle turn
  // is a curve rather than a notch. Drawn under the dots, which are the same colour,
  // so nothing about it reads as two shapes overlapping.
  #drawChains(game, theme) {
    for (const player of game.players) {
      if (player.chain.length < 2) {
        continue
      }
      const colours = theme.dots[player.chainColour % theme.dots.length]
      // Whatever the fattest dot on the chain has swelled to, so the body of the shape
      // is never narrower than the dots drawn on top of it.
      let swell = 0
      for (const dot of player.chain) {
        swell = Math.max(swell, dot.swell)
      }
      const radius = game.layout.radius * (1 + swell)
      this.renderer.blobChain(
        player.chain.map((dot) => {
          const at = game.dotPosition(dot)
          return { x: at.x, y: at.y, grow: dot.grow }
        }),
        {
          color: colours.bright,
          radius,
          cord: radius * CONFIG.CHAIN_CORD_RATIO,
          smooth: radius * CONFIG.CHAIN_SMOOTH_RATIO,
          glow: player.glow,
        },
      )
    }
  }

  #drawCursors(game, theme) {
    if (game.phase !== PHASE.PLAYING) {
      return
    }
    for (const player of game.players) {
      const at = cellCentre(game.layout, player.cursor.col, player.cursor.row)
      const live = player.chain.length > 0
      // A slow breath, so the cursor is findable on a busy board without flashing.
      const pulse = 1 + Math.sin(game.time * 3.4) * (live ? 0.05 : 0.03)
      this.renderer.ring(at.x, at.y, game.layout.radius * 1.34 * pulse, {
        color: live ? theme.cursorActive : theme.cursor,
        width: live ? 3 : 2,
        alpha: live ? 0.9 : 0.55,
        glow: live ? player.glow * 0.25 : 0,
      })
    }
  }

  // Everything above the board belongs to the score bar, so dots falling in from
  // above are hidden behind it rather than sliding over it.
  #drawCurtain(game, theme) {
    const top = game.layout.y - game.layout.cell * 0.22
    this.renderer.panel(0, 0, VIEW_W, top, { fill: theme.background })
  }

  #drawParticles(game) {
    const particles = game.particles
    // Sparks are drawn as the streak they leave: a short ribbon from where they
    // are back to where they were, fading to nothing at the tail.
    for (const spark of particles.sparks) {
      const fade = 1 - spark.age / spark.life
      const tail = {
        x: spark.x - spark.vx * CONFIG.SPARK_STREAK,
        y: spark.y - spark.vy * CONFIG.SPARK_STREAK,
      }
      this.renderer.ribbon([{ x: spark.x, y: spark.y }, tail], {
        color: spark.colour,
        width: spark.size * fade,
        alpha: fade,
        taper: [1, 0],
        glow: 1.1 * fade,
      })
      this.renderer.point(spark.x, spark.y, spark.size * 1.6 * fade, {
        color: spark.colour,
        alpha: fade * 0.7,
        glow: 0.8,
      })
    }
    for (const mote of particles.dust) {
      const fade = 1 - mote.age / mote.life
      this.renderer.point(mote.x, mote.y, mote.size * (0.6 + fade), {
        color: mote.colour,
        alpha: fade * 0.35,
        falloff: 2.4,
        glow: 0.35,
      })
    }
    // The light of the dot going, which the sparks come out of. Every particle
    // pipeline adds rather than covers, so what order these four run in makes no
    // difference to the picture.
    for (const flash of particles.flashes) {
      const fade = 1 - flash.age / flash.life
      this.renderer.point(flash.x, flash.y, flash.size * (0.55 + 0.45 * fade), {
        color: flash.colour,
        alpha: fade * 0.85,
        falloff: 1.4,
        glow: 1.4 * fade,
      })
    }
    for (const ring of particles.rings) {
      const t = ring.age / ring.life
      this.renderer.ring(ring.x, ring.y, lerp(2, ring.radius, easeOutCubic(t)), {
        color: ring.colour,
        width: ring.width * (1 - t),
        alpha: (1 - t) * 0.7,
        glow: 0.9 * (1 - t),
      })
    }
  }

  #drawFloaters(game) {
    for (const floater of game.particles.floaters) {
      const t = floater.age / floater.life
      const alpha = 1 - t * t
      this.renderer.text(floater.text, floater.x, floater.y, {
        color: floater.colour,
        alpha,
        size: 16 * floater.scale,
        align: "center",
        baseline: "middle",
        bold: true,
        glow: 0.8 * alpha,
      })
    }
  }

  // ---- the HUD ------------------------------------------------------------
  #drawHud(game, theme) {
    const renderer = this.renderer
    const player = game.player
    const best = game.best[game.mode.id] || 0

    // The title screen has no score to show, and a zero under a panel that says
    // START is just noise.
    if (game.phase !== PHASE.TITLE) {
      renderer.text("Score", 28, 34, { color: theme.text.faint, size: 12 })
      const score = String(player.score)
      renderer.text(score, 28, 64, { color: theme.text.bright, size: 34, bold: true })
      renderer.text("Best", VIEW_W - 28, 34, { color: theme.text.faint, size: 12, align: "right" })
      renderer.text(String(Math.max(best, player.score)), VIEW_W - 28, 60, {
        color: theme.text.dim,
        size: 22,
        align: "right",
      })
      // The multiplier only appears once it is worth something, and glows, since it
      // is what a long chain earned. It sits beside the score rather than above the
      // board, which is where the page's own buttons are.
      if (player.multiplier > 1) {
        renderer.text(`x${player.multiplier}`, 28 + renderer.measureText(score, 34) + 12, 62, {
          color: theme.accent,
          size: 22,
          bold: true,
          glow: 0.7,
        })
      }
    }

    // What the chain in hand is worth, where the 32blit version put it: beside the
    // score, as a sum waiting to be banked.
    if (player.chain.length >= 2) {
      const worth = CONFIG.chainScore(player.chain.length) * player.multiplier
      const colours = theme.dots[player.chainColour % theme.dots.length]
      const ready = player.chain.length >= game.mode.minChain
      renderer.text(ready ? `+${worth}` : `${player.chain.length}/${game.mode.minChain}`, 28, 90, {
        color: ready ? colours.bright : theme.text.faint,
        size: 18,
        bold: true,
        glow: ready ? player.glow * 0.4 : 0,
      })
    }

    if (game.mode.timeLimit > 0) {
      this.#drawTimer(game, theme)
    }

    // The strip under the board says only what the board cannot: which level this is,
    // and what a special under the cursor would do. What mode is being played and what
    // that mode is belong in the pause menu, where they are read once, rather than
    // under the board for the whole game.
    const special = game.hoveredSpecial()
    const level = game.currentLevel
    if (special) {
      renderer.text(`${special.name}: ${special.blurb}`, 28, HUD_BOTTOM + 22, {
        color: theme.accent,
        size: 12,
      })
    } else if (level && game.phase === PHASE.PLAYING) {
      renderer.text(`Level ${game.level + 1} of ${game.mode.levels.length}`, 28, HUD_BOTTOM + 16, {
        color: theme.text.faint,
        size: 12,
      })
      renderer.text(level.name, 28, HUD_BOTTOM + 34, {
        color: theme.text.dim,
        size: 15,
        bold: true,
      })
      // What this level has paid against the most it can, which is a real target: the
      // best any order of chains could score while still clearing it. The running score
      // is no use for that, since it carries across levels.
      if (game.levelPar > 0) {
        const reached = game.levelScore >= game.levelPar
        renderer.text(`${game.levelScore} / ${game.levelPar}`, VIEW_W - 92, HUD_BOTTOM + 28, {
          color: reached ? theme.accent : theme.text.dim,
          size: 15,
          align: "right",
          bold: true,
          glow: reached ? 0.8 : 0,
        })
        renderer.text("this level", VIEW_W - 92, HUD_BOTTOM + 12, {
          color: theme.text.faint,
          size: 11,
          align: "right",
        })
      }
    }

    this.pauseVisible = game.phase === PHASE.PLAYING && !game.page
    if (this.pauseVisible) {
      this.#drawPauseButton(theme)
    }
    if (game.banner) {
      this.#drawBanner(game, theme)
    }
  }

  // Two bars in a rounded box. Drawn rather than written, because a glyph for this is
  // not in the atlas and a word would need translating.
  #drawPauseButton(theme) {
    const box = PAUSE_BUTTON
    this.renderer.panel(box.x, box.y, box.w, box.h, { fill: theme.cell, radius: 10 })
    const barW = 4
    const barH = 14
    const gap = 5
    const top = box.y + (box.h - barH) / 2
    const left = box.x + box.w / 2 - gap / 2 - barW
    for (const x of [left, left + barW + gap]) {
      this.renderer.panel(x, top, barW, barH, { fill: theme.text.dim, radius: 2 })
    }
  }

  // The clock: the width of the board, above it, with what is left of it written
  // inside the bar. A thin line with a number beside it reads as a detail; this reads
  // as the thing the mode is about.
  #drawTimer(game, theme) {
    const layout = game.layout
    const height = 24
    const y = layout.y - layout.cell * 0.22 - height - 12
    const left = game.timeLeft / game.mode.timeLimit
    const running = left < 0.2 ? theme.warn : theme.accent
    this.renderer.panel(layout.x, y, layout.width, height, {
      fill: theme.cell,
      radius: height / 2,
    })
    if (left > 0) {
      // Never shorter than the number written in it, or the last few seconds are dark
      // text hanging off the end of a stub.
      const filled = Math.max(layout.width * left, 58)
      this.renderer.panel(layout.x, y, filled, height, {
        fill: running,
        radius: height / 2,
        glow: left < 0.2 ? 1.2 : 0.35,
      })
    }
    // Inside the bar, at its left end where the time still is. On the theme's own
    // background colour, so it reads against the filled part behind it.
    this.renderer.text(`${Math.ceil(game.timeLeft)}`, layout.x + 14, y + height / 2, {
      color: theme.background,
      size: 15,
      baseline: "middle",
      bold: true,
    })
  }

  // A level cleared, over the board that is already dropping in behind it: it rises
  // and fades, so it never has to be dismissed.
  #drawBanner(game, theme) {
    const banner = game.banner
    const t = banner.age / banner.life
    // Hold, then go: a line that starts fading immediately reads as a glitch.
    const alpha = clamp((1 - t) * 2.2, 0, 1) * clamp(t * 8, 0, 1)
    const y = game.layout.y + game.layout.height / 2 - t * 26
    this.renderer.text(banner.text, VIEW_W / 2, y, {
      color: theme.text.bright,
      size: 30,
      align: "center",
      baseline: "middle",
      bold: true,
      alpha,
      glow: alpha * 0.8,
    })
    if (banner.sub) {
      this.renderer.text(banner.sub, VIEW_W / 2, y + 30, {
        color: theme.accent,
        size: 15,
        align: "center",
        baseline: "middle",
        alpha,
        glow: alpha * 0.5,
      })
    }
  }

  // ---- menus --------------------------------------------------------------
  // Rows in a panel. Three kinds of row are drawn: a heading, a pressable row, and a
  // row of options laid out side by side - which is what a setting is here, so a tap
  // can reach a particular value instead of pressing the same row until it comes round.
  #drawMenu(game, theme) {
    const renderer = this.renderer
    const rows = game.menuRows()
    const heading = this.#menuHeading(game)
    const headerHeight = heading.reduce((total, line) => total + line.size + 10, 0) + 22
    const width = 460
    const x = (VIEW_W - width) / 2
    let contentHeight = 0
    for (const row of rows) {
      contentHeight += this.#rowHeight(row)
    }
    // The hint lives inside the panel: under it, it lands on the board behind and is
    // unreadable on a busy field. It says what the selected row is for - never how to
    // work a menu, which needs no saying.
    const hint = this.#menuHint(game, rows)
    // The room for it is always there, whether or not the selected row has anything to
    // say: a panel that changes height as the cursor moves down it is a panel that
    // jumps under the cursor.
    const height = contentHeight + headerHeight + 30 + 30
    const y = clamp((VIEW_H - height) / 2, 16, Math.max(16, VIEW_H - height - 16))

    // The board stays visible behind the panel, dimmed rather than hidden: a menu is
    // over the game, not instead of it.
    renderer.panel(0, 0, VIEW_W, VIEW_H, {
      fill: theme.scrim.color,
      alpha: theme.scrim.alpha,
    })
    renderer.panel(x, y, width, height, { fill: theme.panel, radius: 18 })
    renderer.panel(x, y, width, height, { stroke: theme.panelEdge, width: 1.5, radius: 18 })

    let textY = y + 38
    for (const line of heading) {
      renderer.text(line.text, VIEW_W / 2, textY, {
        color: line.colour,
        size: line.size,
        align: "center",
        bold: line.bold,
        glow: line.glow || 0,
      })
      textY += line.size + 10
    }

    let rowY = y + headerHeight + 12
    this.menuHits.length = 0
    rows.forEach((row, index) => {
      const rowHeight = this.#rowHeight(row)
      if (row.kind === "heading") {
        renderer.text(row.label, x + 26, rowY + rowHeight - 8, {
          color: theme.text.faint,
          size: 12,
        })
      } else if (row.kind === "options") {
        this.#drawOptions(game, theme, row, index, x, rowY, width, rowHeight)
      } else if (row.kind === "grid") {
        this.#drawGrid(game, theme, row, index, x, rowY, width)
      } else if (row.kind === "button") {
        this.#drawButton(game, theme, row, index, x, rowY, width, rowHeight)
      } else {
        this.#drawRow(game, theme, row, index, x, rowY, width, rowHeight)
      }
      rowY += rowHeight
    })

    if (hint) {
      renderer.text(hint.text, VIEW_W / 2, y + height - 12, {
        color: hint.colour,
        size: 12,
        align: "center",
      })
    }
  }

  #rowHeight(row) {
    if (row.kind === "heading") {
      return 24
    }
    if (row.kind === "options") {
      return row.options.some((option) => option.preview) ? 58 : 40
    }
    if (row.kind === "grid") {
      const lines = Math.ceil(row.options.length / (row.columns || 1))
      return lines * (GRID_CELL_H + GRID_GAP) + 6
    }
    if (row.kind === "button") {
      return GRID_CELL_H + 14
    }
    return 32
  }

  // A pressable row: the label, whatever it currently reads, and a filled box behind
  // it when it is the one selected.
  #drawRow(game, theme, row, index, x, rowY, width, rowHeight) {
    const renderer = this.renderer
    const selected = index === game.menuIndex
    const box = { x: x + 14, y: rowY, w: width - 28, h: rowHeight - 4 }
    this.menuHits.push({ index, option: null, ...box })
    if (selected) {
      renderer.panel(box.x, box.y, box.w, box.h, { fill: theme.panelEdge, radius: 9 })
    }
    const middle = box.y + box.h / 2
    renderer.text(row.label, x + 26, middle, {
      color: selected ? theme.text.bright : theme.text.normal,
      size: 17,
      baseline: "middle",
      bold: selected,
    })
    if (row.value != null) {
      renderer.text(row.value, x + width - 26, middle, {
        color: selected ? theme.accent : theme.text.dim,
        size: 16,
        align: "right",
        baseline: "middle",
        bold: selected,
      })
    }
    // A mode the player last played is marked, so a returning player can see where
    // they left off without it being pre-pressed for them.
    if (row.current) {
      renderer.disc(x + width - 34, middle, 4, { color: theme.accent, glow: 0.6 })
    }
  }

  // The one thing on a page most worth pressing: full width, centred, and filled
  // whether or not the cursor is on it, so it reads as the way forward at a glance. The
  // cursor adds an outline rather than the fill, since the fill is already spent saying
  // what this row is.
  #drawButton(game, theme, row, index, x, rowY, width, rowHeight) {
    const renderer = this.renderer
    const selected = index === game.menuIndex
    const box = { x: x + 26, y: rowY, w: width - 52, h: rowHeight - 14 }
    this.menuHits.push({ index, option: null, ...box })
    // No glow: the halo is added over the frame in the composite pass, and this button
    // has dark text on a bright fill, so lighting it washes out its own label. A filled
    // accent box needs no help being noticed.
    renderer.panel(box.x, box.y, box.w, box.h, { fill: theme.accent, radius: 12 })
    if (selected) {
      renderer.panel(box.x, box.y, box.w, box.h, {
        stroke: theme.text.bright,
        width: 2,
        radius: 12,
      })
    }
    renderer.text(row.label, box.x + box.w / 2, box.y + box.h / 2, {
      color: theme.panel,
      size: 19,
      align: "center",
      baseline: "middle",
      bold: true,
    })
  }

  // A block of buttons: the mode grid. Two across rather than a list of rows, because
  // a button the width of a thumb reads as something to press and a line of text reads
  // as something to consider. The one under the cursor is filled, since pressing it is
  // what happens next; the mode last played carries a dot.
  #drawGrid(game, theme, row, index, x, rowY, width) {
    const renderer = this.renderer
    const columns = row.columns || 1
    const cellW = (width - 52 - GRID_GAP * (columns - 1)) / columns
    row.options.forEach((option, optionIndex) => {
      const box = {
        x: x + 26 + (optionIndex % columns) * (cellW + GRID_GAP),
        y: rowY + Math.floor(optionIndex / columns) * (GRID_CELL_H + GRID_GAP),
        w: cellW,
        h: GRID_CELL_H,
      }
      const under = index === game.menuIndex && optionIndex === row.selected
      this.menuHits.push({ index, option: optionIndex, ...box })
      renderer.panel(box.x, box.y, box.w, box.h, {
        fill: under ? theme.accent : theme.cell,
        radius: 12,
        alpha: under ? 1 : 0.75,
      })
      renderer.text(option.label, box.x + box.w / 2, box.y + box.h / 2, {
        color: under ? theme.panel : theme.text.normal,
        size: 16,
        align: "center",
        baseline: "middle",
        bold: under,
      })
      if (option.current) {
        renderer.disc(box.x + box.w - 12, box.y + 12, 3.5, {
          color: under ? theme.panel : theme.accent,
          glow: under ? 0 : 0.6,
        })
      }
    })
  }

  // A row of options, each its own pressable box. The chosen one is filled; the row is
  // outlined while the cursor is on it, so a keyboard player can see where they are
  // without the row looking pressed.
  #drawOptions(game, theme, row, index, x, rowY, width, rowHeight) {
    const renderer = this.renderer
    const onRow = index === game.menuIndex
    const gap = 8
    const count = row.options.length
    const available = width - 52
    const boxW = (available - gap * (count - 1)) / count
    const boxH = rowHeight - 10
    row.options.forEach((option, optionIndex) => {
      const box = {
        x: x + 26 + optionIndex * (boxW + gap),
        y: rowY,
        w: boxW,
        h: boxH,
      }
      const chosen = optionIndex === row.selected
      this.menuHits.push({ index, option: optionIndex, ...box })
      renderer.panel(box.x, box.y, box.w, box.h, {
        fill: chosen ? theme.accent : theme.cell,
        radius: 10,
        alpha: chosen ? 1 : 0.7,
      })
      if (onRow && chosen) {
        renderer.panel(box.x, box.y, box.w, box.h, {
          stroke: theme.text.bright,
          width: 2,
          radius: 10,
        })
      }
      if (option.preview) {
        this.#drawThemePreview(option.preview, box, chosen ? theme.accent : null)
      } else {
        renderer.text(option.label, box.x + box.w / 2, box.y + box.h / 2, {
          color: chosen ? theme.panel : theme.text.normal,
          size: 15,
          align: "center",
          baseline: "middle",
          bold: chosen,
        })
      }
    })
  }

  // A theme as three by three dots on its own background: what the option does rather
  // than what it is called, which is the point of a preview.
  #drawThemePreview(themeId, box, ring) {
    const renderer = this.renderer
    const preview = THEMES[themeId]
    if (!preview) {
      return
    }
    const inset = 5
    const inner = { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 }
    renderer.panel(inner.x, inner.y, inner.w, inner.h, {
      fill: preview.background,
      radius: 7,
    })
    const cells = 3
    const cell = Math.min(inner.w, inner.h) / cells
    const radius = cell * 0.3
    const left = inner.x + (inner.w - cell * cells) / 2
    const top = inner.y + (inner.h - cell * cells) / 2
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const colours = preview.dots[(row * cells + col) % preview.dots.length]
        renderer.disc(left + (col + 0.5) * cell, top + (row + 0.5) * cell, radius, {
          color: colours.base,
        })
      }
    }
    if (ring) {
      renderer.panel(inner.x, inner.y, inner.w, inner.h, {
        stroke: ring,
        width: 1.5,
        radius: 7,
      })
    }
  }

  // What the selected row is for. A rebind says what it is waiting for, a mode says
  // what it is, and anything else says nothing: how to work a menu is not worth a line.
  #menuHint(game, rows) {
    const theme = game.theme
    if (game.rebinding) {
      return { text: "Press a key or button, or escape to cancel", colour: theme.accent }
    }
    const row = rows[game.menuIndex]
    if (row && row.hint) {
      return { text: row.hint, colour: theme.text.faint }
    }
    return null
  }

  // What sits above the rows: the game's name on the title, and what happened on
  // the game-over screen.
  #menuHeading(game) {
    const theme = game.theme
    switch (game.page) {
      case "title":
        return [
          { text: TITLE, colour: theme.text.bright, size: 42, bold: true, glow: 0.45 },
          { text: "Link dots of a colour to pop them", colour: theme.text.dim, size: 13 },
        ]
      case "over": {
        // Clearing the last authored level is not "a board cleared", it is the whole
        // mode finished, which is the one thing in this game that can be won.
        const outcome =
          game.outcome === "won" && game.mode.levels
            ? "All levels cleared"
            : OUTCOMES[game.outcome] || "Game over"
        const best = game.best[game.mode.id] || 0
        const record = game.player.score >= best && game.player.score > 0
        const lines = [
          { text: outcome, colour: theme.text.bright, size: 26, bold: true },
          {
            text: `${game.player.score}`,
            colour: record ? theme.accent : theme.text.normal,
            size: 40,
            bold: true,
            glow: record ? 1 : 0,
          },
          {
            text: record ? "Best yet" : `Best ${best}`,
            colour: theme.text.dim,
            size: 13,
          },
        ]
        // On a board that is never refilled and was never designed, what is left on it
        // is the measure of the game: most random boards cannot be emptied at all, so
        // "how few did you leave" is the question rather than "did you clear it".
        if (game.mode.refill === false && !game.mode.levels && game.board) {
          const left = game.board.count
          lines.push({
            text: left === 1 ? "1 dot left" : `${left} dots left`,
            colour: theme.text.faint,
            size: 13,
          })
        }
        return lines
      }
      case "modes":
        return [
          { text: "New game", colour: theme.text.bright, size: 26, bold: true },
          { text: "Choose a mode", colour: theme.text.dim, size: 13 },
        ]
      case "controls":
        return [{ text: "Controls", colour: theme.text.bright, size: 26, bold: true }]
      default:
        // The pause menu is where the mode says what it is. It used to be written under
        // the board for the whole game, where it was read once and then in the way.
        return [
          { text: game.mode.name, colour: theme.text.bright, size: 26, bold: true },
          { text: game.mode.blurb, colour: theme.text.dim, size: 13 },
        ]
    }
  }
}
