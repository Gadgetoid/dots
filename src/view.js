// Drawing. Everything the player sees is decided here and issued as renderer
// primitives in view space; the game holds no drawing state and the renderer holds
// no game state.
//
// Painter order matters: the well, then the empty cells, then the chain, then the
// dots over it, then the particles, then a curtain over the strip above the board
// where refilled dots are still falling in, and the HUD and any menu over that.

import { VIEW_W, VIEW_H, CONFIG, cellCentre } from "./config.js"
import { PHASE } from "./game.js"
import { catmullRom, clamp, easeOutCubic, lerp } from "./math.js"

// Where the mode line sits, under the board. The score bar above it needs no
// constant: it is measured from the top of the field.
const HUD_BOTTOM = VIEW_H - 74

const TITLE = "DOTS"

// What a finished board is told it did.
const OUTCOMES = {
  lost: "NO MOVES LEFT",
  timeup: "TIME UP",
  won: "BOARD CLEARED",
}

export class GameView {
  constructor(renderer) {
    this.renderer = renderer
    // Kept so a resize can be recomputed without the caller having to hold it.
    this.rect = { width: 0, height: 0 }
    // Where each menu row was drawn this frame, so a tap can find it. Recorded by
    // the drawing rather than worked out twice: the layout is only written once.
    this.menuHits = []
  }

  // Which menu row a point in view space is over, or null.
  menuRowAt(x, y) {
    for (const hit of this.menuHits) {
      if (x >= hit.x && y >= hit.y && x <= hit.x + hit.w && y <= hit.y + hit.h) {
        return hit.index
      }
    }
    return null
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
        wobble: { amount: dot.wobbleAmount, axis: dot.wobbleAxis },
        sheen: theme.id === "dark" ? 0.18 : 0.1,
        // Only what is held glows, so the board is calm until the player picks
        // something up and the bloom is entirely theirs.
        glow: linked ? game.players[dot.claim ?? 0].glow * 0.35 : 0,
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

  // The line through a chain: one smooth curve, drawn under the dots, glowing by
  // how much is on it.
  #drawChains(game, theme) {
    for (const player of game.players) {
      if (player.chain.length < 2) {
        continue
      }
      const colours = theme.dots[player.chainColour % theme.dots.length]
      const points = catmullRom(
        player.chain.map((dot) => game.dotPosition(dot)),
        CONFIG.CHAIN_SMOOTHING,
      )
      this.renderer.ribbon(points, {
        color: colours.bright,
        width: game.layout.radius * CONFIG.CHAIN_WIDTH_RATIO,
        glow: player.glow,
      })
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
      renderer.text("SCORE", 28, 34, { color: theme.text.faint, size: 12 })
      const score = String(player.score)
      renderer.text(score, 28, 64, { color: theme.text.bright, size: 34, bold: true })
      renderer.text("BEST", VIEW_W - 28, 34, { color: theme.text.faint, size: 12, align: "right" })
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

    // The bottom line: what a special under the cursor does, or the mode's own
    // description. The blurb takes precedence because it is the only place a
    // player is told what a powerup is.
    const special = game.hoveredSpecial()
    const line = special ? `${special.name}: ${special.blurb}` : game.mode.blurb
    renderer.text(line, VIEW_W / 2, HUD_BOTTOM + 30, {
      color: special ? theme.accent : theme.text.faint,
      size: 12,
      align: "center",
    })
    renderer.text(game.mode.name, VIEW_W / 2, HUD_BOTTOM + 8, {
      color: theme.text.dim,
      size: 15,
      align: "center",
      bold: true,
    })
  }

  // The clock, under the score rather than over the board: the page's own buttons
  // sit above the field and a bar up there would be behind them.
  #drawTimer(game, theme) {
    const width = 180
    const x = (VIEW_W - width) / 2
    const y = 84
    const left = game.timeLeft / game.mode.timeLimit
    this.renderer.panel(x, y, width, 6, { fill: theme.cell, radius: 3 })
    if (left > 0) {
      // It goes red at the end, which is the only warning the mode gives.
      const colour = left < 0.2 ? theme.warn : theme.accent
      this.renderer.panel(x, y, Math.max(width * left, 2), 6, {
        fill: colour,
        radius: 3,
        glow: left < 0.2 ? 1.2 : 0.4,
      })
    }
    this.renderer.text(`${Math.ceil(game.timeLeft)}`, VIEW_W / 2, y - 8, {
      color: left < 0.2 ? theme.warn : theme.text.dim,
      size: 14,
      align: "center",
    })
  }

  // ---- menus --------------------------------------------------------------
  #drawMenu(game, theme) {
    const renderer = this.renderer
    const rows = game.menuRows()
    const rowHeight = 34
    const headingHeight = 26
    let contentHeight = 0
    for (const row of rows) {
      contentHeight += row.kind === "heading" ? headingHeight : rowHeight
    }
    const heading = this.#menuHeading(game)
    const headerHeight = heading.length * 30 + 18
    const width = 460
    // The hint lives inside the panel: under it, it lands on the board behind and
    // is unreadable on a busy field.
    const hintHeight = 34
    const height = contentHeight + headerHeight + hintHeight + 46
    const x = (VIEW_W - width) / 2
    const y = clamp((VIEW_H - height) / 2, 24, VIEW_H - height - 24)

    // The board stays visible behind the panel, dimmed rather than hidden: a menu
    // is over the game, not instead of it.
    renderer.panel(0, 0, VIEW_W, VIEW_H, { fill: theme.background, alpha: 0.72 })
    renderer.panel(x, y, width, height, { fill: theme.panel, radius: 18 })
    renderer.panel(x, y, width, height, {
      stroke: theme.panelEdge,
      width: 1.5,
      radius: 18,
    })

    let textY = y + 40
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

    let rowY = y + headerHeight + 30
    this.menuHits.length = 0
    rows.forEach((row, index) => {
      if (row.kind === "heading") {
        renderer.text(row.label, x + 28, rowY + 16, {
          color: theme.text.faint,
          size: 12,
        })
        rowY += headingHeight
        return
      }
      const selected = index === game.menuIndex
      this.menuHits.push({ index, x: x + 14, y: rowY - 2, w: width - 28, h: rowHeight - 4 })
      if (selected) {
        renderer.panel(x + 14, rowY - 2, width - 28, rowHeight - 4, {
          fill: theme.panelEdge,
          radius: 8,
        })
      }
      renderer.text(row.label, x + 28, rowY + 20, {
        color: selected ? theme.text.bright : theme.text.normal,
        size: 17,
        bold: selected,
      })
      if (row.value != null) {
        renderer.text(row.value, x + width - 28, rowY + 20, {
          color: selected ? theme.accent : theme.text.dim,
          size: 17,
          align: "right",
          bold: selected,
        })
      }
      // A row that can be adjusted says so, so it is obvious which rows take a
      // left and right and which take a press.
      if (selected && row.kind === "choice") {
        renderer.text(
          "<",
          x + width - 28 - renderer.measureText(row.value ?? "", 17) - 14,
          rowY + 20,
          {
            color: theme.text.faint,
            size: 14,
            align: "right",
          },
        )
        renderer.text(">", x + width - 18, rowY + 20, {
          color: theme.text.faint,
          size: 14,
        })
      }
      rowY += rowHeight
    })

    // What the selected row is for, or how to work the menu at all.
    const row = rows[game.menuIndex]
    const hint = game.rebinding
      ? "PRESS A KEY OR BUTTON. ESCAPE TO CANCEL"
      : (row && row.hint) || "MOVE TO CHOOSE, PRESS TO CONFIRM"
    renderer.text(hint, VIEW_W / 2, y + height - 14, {
      color: game.rebinding ? theme.accent : theme.text.faint,
      size: 12,
      align: "center",
    })
  }

  // What sits above the rows: the game's name on the title, and what happened on
  // the game-over screen.
  #menuHeading(game) {
    const theme = game.theme
    switch (game.page) {
      case "title":
        return [
          { text: TITLE, colour: theme.text.bright, size: 44, bold: true, glow: 0.45 },
          { text: "LINK DOTS OF A COLOUR TO POP THEM", colour: theme.text.dim, size: 13 },
        ]
      case "over": {
        const outcome = OUTCOMES[game.outcome] || "GAME OVER"
        const best = game.best[game.mode.id] || 0
        const record = game.player.score >= best && game.player.score > 0
        return [
          { text: outcome, colour: theme.text.bright, size: 26, bold: true },
          {
            text: `${game.player.score}`,
            colour: record ? theme.accent : theme.text.normal,
            size: 40,
            bold: true,
            glow: record ? 1 : 0,
          },
          {
            text: record ? "BEST YET" : `BEST ${best}`,
            colour: theme.text.dim,
            size: 13,
          },
        ]
      }
      case "controls":
        return [{ text: "CONTROLS", colour: theme.text.bright, size: 26, bold: true }]
      default:
        return [{ text: "PAUSED", colour: theme.text.bright, size: 26, bold: true }]
    }
  }
}
