// The game: phases, the chain rules as the player experiences them, scoring, the
// menus and the settings. It owns a Board and a Particles, and it never draws.
//
// Chain state is per player, not per game. One player is the only case there is
// today, but a chain, a cursor, a score and a multiplier all belong to whoever is
// holding them, and a dot records which player's chain has claimed it - so a
// second pad is a second entry in `players` rather than a second copy of all of
// this. Every input method therefore takes a player index, and defaults to the
// first.

import { Board } from "./board.js"
import { Particles } from "./particles.js"
import { Sound } from "./audio.js"
import { GAME_MODES, modeById, defaultOutcome, modeRefills } from "./modes/index.js"
import { SPECIAL_BY_ID } from "./specials.js"
import {
  CONFIG,
  DEFAULT_SETTINGS,
  BINDABLE_CONTROLS,
  BINDING_DEVICES,
  RESERVED_KEYS,
  RESERVED_BUTTONS,
  boardLayout,
  cellCentre,
  freshBindings,
} from "./config.js"
import { THEMES, THEME_IDS } from "./palette.js"
import { resolveTuning } from "./scales.js"
import { clamp, lerp } from "./math.js"
import {
  loadBest,
  saveBest,
  loadSettings,
  saveSettings,
  loadBindings,
  saveBindings,
} from "./persistence.js"

export const PHASE = { TITLE: "title", PLAYING: "playing", OVER: "over" }

// How many players the input layer may hand out slots to. One is played today; the
// state is per player throughout so raising this is a matter of assigning devices.
export const MAX_PLAYERS = 4

// How loud a landing has to be to be worth a sound, and how many of them may be
// voiced in one frame: a refilled board lands a dozen dots at once, and playing
// all of them is a clatter rather than a rain.
const LAND_AUDIBLE = 6
const LAND_VOICES = 3

export class Player {
  constructor(index) {
    this.index = index
    this.score = 0
    this.multiplier = 1
    this.cursor = { col: 0, row: 0 }
    // The dots being held, in the order they were linked.
    this.chain = []
    // The drawn glow, chasing what the chain's length is worth, so it builds and
    // fades rather than stepping.
    this.glow = 0
    // Specials banked for later use. Nothing deals them yet; see specials.js.
    this.held = []
    // Whether a pointer is dragging this player's chain, so releasing the pointer
    // is what spends it and a button press is not.
    this.dragging = false
  }

  get chainColour() {
    return this.chain.length > 0 ? this.chain[0].colour : -1
  }

  reset() {
    this.score = 0
    this.multiplier = 1
    this.chain.length = 0
    this.glow = 0
    this.held.length = 0
    this.dragging = false
  }
}

export class Game {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS }
    this.bindings = freshBindings()
    this.best = {}
    this.phase = PHASE.TITLE
    // Which menu is open, or null while the board is being played. The title and
    // the game-over screen are menus like any other, which is why a press does the
    // same thing on all three.
    this.page = "title"
    this.pageReturn = null
    this.menuIndex = 0
    // The control a menu row is waiting for a key or a button for, as
    // { device, control }, or null.
    this.rebinding = null
    // Which device the player last used, so the help line can name the right one.
    this.inputMode = "keyboard"

    this.mode = modeById(this.settings.mode)
    // The tuning the menus and the title screen are in, until a mode is started and
    // sets its own.
    this.tuning = resolveTuning(this.mode.tuning)
    this.board = null
    this.layout = boardLayout(this.mode.cols, this.mode.rows)
    this.particles = new Particles()
    this.players = [new Player(0)]
    this.playerCount = 1

    this.time = 0
    this.timeLeft = 0
    // Dots on their way out: removed from the grid already, drawn shrinking until
    // their turn to burst, so a long chain unzips instead of vanishing.
    this.popping = []
    // Counted from the moment the board settles, so a loss is never declared on the
    // same frame as the last chain was spent.
    this.settleFor = 0
    this.outcome = null
    this.overFor = 0
    // Where a mode with authored levels has got to, and what the score was when the
    // current one was dealt, so retrying a level costs what was made on it and not
    // what was banked before it.
    this.level = 0
    this.levelStartScore = 0
    // A line over the board for a moment: a level cleared, and which is next.
    this.banner = null

    this.dealAttractBoard()
    this.#restoreState()
  }

  get player() {
    return this.players[0]
  }

  get theme() {
    return THEMES[this.settings.theme] || THEMES.dark
  }

  get brightness() {
    const levels = CONFIG.BRIGHTNESS_LEVELS
    return levels[clamp(this.settings.brightness, 0, levels.length - 1)]
  }

  // Nothing may be linked while dots are still bursting: the board is consistent,
  // but the dots that are going have not finished going.
  get busy() {
    return this.popping.length > 0
  }

  // ---- persistence --------------------------------------------------------
  async #restoreState() {
    const [settings, bindings, best] = await Promise.all([
      loadSettings(),
      loadBindings(),
      loadBest(),
    ])
    if (settings) {
      this.settings = { ...this.settings, ...settings }
      this.mode = modeById(this.settings.mode)
      this.layout = boardLayout(this.mode.cols, this.mode.rows)
      Sound.enabled = this.settings.sound
      // Storage answers a frame or two in, by which time a board has already been
      // dealt for the title: deal the remembered mode's instead.
      if (this.phase === PHASE.TITLE) {
        this.dealAttractBoard()
      }
    }
    if (bindings) {
      // Merge rather than replace, so a control added since the table was written
      // still has its default.
      const fresh = freshBindings()
      for (const device of BINDING_DEVICES) {
        this.bindings[device.id] = { ...fresh[device.id], ...(bindings[device.id] || {}) }
      }
    }
    if (best) {
      this.best = best
    }
  }

  #storeSettings() {
    saveSettings({ ...this.settings })
  }

  // ---- lifecycle ----------------------------------------------------------
  // Which authored level is being played, or null in a mode that deals its own.
  get currentLevel() {
    if (!this.mode.levels || this.mode.levels.length === 0) {
      return null
    }
    return this.mode.levels[clamp(this.level, 0, this.mode.levels.length - 1)]
  }

  get lastLevel() {
    return !this.mode.levels || this.level >= this.mode.levels.length - 1
  }

  // A board for the title screen to sit over, so the game shows itself rather than
  // offering a menu on an empty field. It is dealt and left alone: nothing is
  // playing it, and starting a mode deals a fresh one.
  dealAttractBoard() {
    this.#dealBoard()
  }

  #freshBoard() {
    return new Board({
      cols: this.mode.cols,
      rows: this.mode.rows,
      minChain: this.mode.minChain,
      colours: this.mode.colours,
      pickColour: this.mode.pickColour ? this.mode.pickColour.bind(this.mode) : null,
      specialChance: this.mode.specialChance,
    })
  }

  // Deal whatever the mode's board is: an authored level where it has them, and a
  // fresh random one where it does not.
  #dealBoard() {
    this.board = this.#freshBoard()
    const level = this.currentLevel
    if (level) {
      this.board.load(level.layout)
    } else {
      this.board.fill()
    }
    if (this.mode.onSettled) {
      // A mode that curates its board gets to do so before the first move, not only
      // after the first pop.
      this.mode.onSettled(this.board)
    }
  }

  start(modeId = this.settings.mode) {
    this.mode = modeById(modeId)
    this.settings.mode = this.mode.id
    this.#storeSettings()
    this.layout = boardLayout(this.mode.cols, this.mode.rows)
    // What the mode sounds like. Resolved here rather than held on the mode, because
    // a mode may ask for a random tuning and then it is a different one per session.
    this.tuning = resolveTuning(this.mode.tuning)
    Sound.setTuning(this.tuning)
    this.level = 0
    this.levelStartScore = 0
    this.banner = null
    this.#dealBoard()
    this.particles.clear()
    this.popping.length = 0
    for (const player of this.players) {
      player.reset()
      player.cursor = { col: Math.floor(this.mode.cols / 2), row: Math.floor(this.mode.rows / 2) }
    }
    this.timeLeft = this.mode.timeLimit
    this.outcome = null
    this.overFor = 0
    this.settleFor = 0
    this.phase = PHASE.PLAYING
    this.page = null
    this.menuIndex = 0
  }

  toTitle() {
    this.phase = PHASE.TITLE
    this.page = "title"
    this.menuIndex = 0
    this.rebinding = null
    this.dealAttractBoard()
  }

  // Move on to the next authored level, keeping the score. What a mode with levels
  // does instead of finishing when a board comes up clear.
  #nextLevel() {
    this.level++
    this.levelStartScore = this.player.score
    this.#dealBoard()
    this.popping.length = 0
    for (const player of this.players) {
      player.chain.length = 0
      player.multiplier = 1
      player.glow = 0
      player.dragging = false
    }
    this.settleFor = 0
    this.overFor = 0
    this.banner = { text: "LEVEL CLEARED", sub: this.currentLevel.name, age: 0, life: 2.4 }
    Sound.clear()
  }

  // Deal the current level again, at the score it was dealt at. A level with no
  // moves left is a puzzle got wrong rather than a game over, so this is what the
  // game-over screen offers instead of starting from the first one.
  retryLevel() {
    if (!this.currentLevel) {
      this.start(this.mode.id)
      return
    }
    this.player.score = this.levelStartScore
    this.#dealBoard()
    this.particles.clear()
    this.popping.length = 0
    for (const player of this.players) {
      player.chain.length = 0
      player.multiplier = 1
      player.glow = 0
      player.dragging = false
      player.cursor = { col: Math.floor(this.mode.cols / 2), row: Math.floor(this.mode.rows / 2) }
    }
    this.outcome = null
    this.overFor = 0
    this.settleFor = 0
    this.banner = null
    this.phase = PHASE.PLAYING
    this.page = null
    this.menuIndex = 0
  }

  #finish(outcome) {
    this.outcome = outcome
    this.phase = PHASE.OVER
    this.page = "over"
    this.menuIndex = 0
    for (const player of this.players) {
      this.#dropChain(player, true)
    }
    const score = this.player.score
    if (!(this.best[this.mode.id] >= score)) {
      this.best[this.mode.id] = score
      saveBest({ ...this.best })
    }
    if (outcome === "won") {
      Sound.clear()
    } else {
      Sound.fail()
    }
  }

  // ---- the frame ----------------------------------------------------------
  advance(dt) {
    this.time += dt
    this.particles.step(dt)
    if (this.banner) {
      this.banner.age += dt
      if (this.banner.age >= this.banner.life) {
        this.banner = null
      }
    }
    if (!this.board) {
      return
    }
    if (this.page) {
      // A menu leaves the board alone but keeps it breathing, so the field behind
      // the panel is not a still image.
      this.board.step(dt)
      this.#advanceGlow(dt * 2)
      return
    }
    this.#advanceBoard(dt)
    this.#advancePopping(dt)
    this.#advanceGlow(dt)
    this.#advanceChainTrail(dt)
    if (this.mode.timeLimit > 0 && this.outcome == null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt)
      if (this.timeLeft === 0) {
        this.#finish("timeup")
        return
      }
    }
    this.#advanceOutcome(dt)
  }

  #advanceBoard(dt) {
    // Landings are collected rather than voiced as they happen, so a whole
    // refilled board is one soft rain instead of a dozen overlapping knocks.
    let voices = 0
    this.board.step(dt, (dot, speed) => {
      if (speed >= LAND_AUDIBLE && voices < LAND_VOICES) {
        voices++
        Sound.land(clamp(speed / 22, 0.3, 1.4))
      }
      // A dot landing shakes the one it landed on, so a column settles as a column.
      const below = this.board.at(dot.col, dot.row + 1)
      if (below) {
        below.nudge(speed * CONFIG.LAND_SQUASH * 0.5, 0)
      }
    })
  }

  #advancePopping(dt) {
    if (this.popping.length === 0) {
      return
    }
    let pending = false
    for (const going of this.popping) {
      going.at -= dt
      if (going.at > 0) {
        pending = true
        continue
      }
      if (!going.burst) {
        going.burst = true
        const theme = this.theme.dots[going.colour % this.theme.dots.length]
        this.particles.pop(
          going.x,
          going.y,
          theme.bright,
          this.layout.radius / 30,
          this.layout.radius,
        )
        Sound.pop(going.index)
        for (const neighbour of going.neighbours) {
          neighbour.nudge(CONFIG.WOBBLE_NEIGHBOUR, going.axis)
        }
      }
    }
    if (pending) {
      return
    }
    // The last dot has gone: close the gaps and top up. The grid was already
    // consistent, so this only decides where things fall to.
    this.popping.length = 0
    this.board.collapse()
    if (modeRefills(this.mode, this.board)) {
      this.board.refill()
    }
    this.settleFor = 0
  }

  #advanceGlow(dt) {
    for (const player of this.players) {
      const target =
        player.chain.length >= 2
          ? Math.min(
              CONFIG.CHAIN_GLOW.base + (player.chain.length - 2) * CONFIG.CHAIN_GLOW.perDot,
              CONFIG.CHAIN_GLOW.max,
            )
          : 0
      player.glow = lerp(player.glow, target, Math.min(1, CONFIG.CHAIN_GLOW_RATE * dt))
    }
  }

  // Sparks running along a live chain, so building one is not a still picture.
  #advanceChainTrail(dt) {
    for (const player of this.players) {
      if (player.chain.length < 2) {
        continue
      }
      const colour = this.theme.dots[player.chainColour % this.theme.dots.length].bright
      const expected = CONFIG.CHAIN_SPARK_RATE * (player.chain.length - 1) * dt
      let spawn = Math.floor(expected)
      if (Math.random() < expected - spawn) {
        spawn++
      }
      for (let i = 0; i < spawn; i++) {
        const along = Math.random() * (player.chain.length - 1)
        const from = player.chain[Math.floor(along)]
        const to = player.chain[Math.floor(along) + 1]
        const t = along - Math.floor(along)
        const a = this.dotPosition(from)
        const b = this.dotPosition(to)
        this.particles.trail(lerp(a.x, b.x, t), lerp(a.y, b.y, t), colour, this.layout.radius / 30)
      }
    }
  }

  #advanceOutcome(dt) {
    if (this.outcome != null || this.busy || !this.board.settled) {
      this.settleFor = 0
      return
    }
    if (this.settleFor === 0) {
      // First frame of a settled board: this is where a mode gets to curate it.
      const changed = this.mode.onSettled ? this.mode.onSettled(this.board) : null
      if (changed) {
        for (const dot of changed) {
          dot.nudge(CONFIG.WOBBLE_LINK, Math.PI / 2)
        }
        Sound.link(0)
      }
    }
    this.settleFor += dt
    if (this.settleFor < CONFIG.SETTLE_GRACE) {
      return
    }
    const verdict = this.mode.outcome
      ? this.mode.outcome(this.board)
      : defaultOutcome(this.mode, this.board)
    if (verdict == null) {
      this.overFor = 0
      return
    }
    // A dead board sits there for a moment first: long enough to see that nothing
    // matches, short enough not to feel stuck.
    this.overFor += dt
    if (this.overFor < (verdict === "won" ? 0.4 : CONFIG.LOSE_DELAY)) {
      return
    }
    // A cleared level with more behind it moves on rather than ending; the last one
    // ends the game, and having cleared them all is what winning this mode is.
    if (verdict === "won" && !this.lastLevel) {
      this.#nextLevel()
      return
    }
    this.#finish(verdict)
  }

  // ---- geometry -----------------------------------------------------------
  // Where a dot is drawn, taking its fall into account. The view and the chain
  // curve both come off this, so the line follows dots that are still moving.
  dotPosition(dot) {
    return cellCentre(this.layout, dot.col, dot.y)
  }

  // ---- the chain ----------------------------------------------------------
  #claim(player, dot) {
    dot.claim = player.index
    dot.linked = true
    player.chain.push(dot)
  }

  #release(dot) {
    dot.claim = null
    dot.linked = false
  }

  // Start a chain at the cursor, if there is anything there to start one with.
  startChain(playerIndex = 0) {
    const player = this.players[playerIndex]
    if (!player || this.busy || this.page) {
      return false
    }
    const dot = this.board.at(player.cursor.col, player.cursor.row)
    if (!this.board.canStart(dot, player.index) || player.chain.length > 0) {
      return false
    }
    this.#claim(player, dot)
    dot.nudge(CONFIG.WOBBLE_LINK, 0)
    Sound.link(0)
    return true
  }

  // Take the chain to a cell, which is what both a cursor move and a pointer drag
  // amount to. Extends, retracts or does nothing, by the board's rules.
  extendTo(playerIndex, col, row) {
    const player = this.players[playerIndex]
    if (!player || player.chain.length === 0) {
      return false
    }
    const dot = this.board.at(col, row)
    const action = this.board.linkAction(player.chain, dot, player.index)
    if (action === "extend") {
      const previous = player.chain[player.chain.length - 1]
      const axis = Math.atan2(dot.row - previous.row, dot.col - previous.col)
      this.#claim(player, dot)
      dot.nudge(CONFIG.WOBBLE_LINK, axis)
      // The wave that runs back down the chain behind the new dot, dying away as
      // it goes: the line is one jelly thing rather than a row of separate ones.
      let amount = CONFIG.WOBBLE_CHAIN_WAVE
      for (let i = player.chain.length - 2; i >= 0; i--) {
        player.chain[i].nudge(amount, axis)
        amount *= CONFIG.WOBBLE_CHAIN_FALLOFF
      }
      Sound.link(player.chain.length - 1)
      return true
    }
    if (action === "retract") {
      const dropped = player.chain.pop()
      this.#release(dropped)
      dropped.nudge(-CONFIG.WOBBLE_LINK * 0.6, 0)
      return true
    }
    return false
  }

  // Spend the chain, if it is long enough. Returns what it scored, or 0.
  popChain(playerIndex = 0) {
    const player = this.players[playerIndex]
    if (!player || player.chain.length < this.mode.minChain) {
      return 0
    }
    const chain = player.chain.slice()
    const length = chain.length
    const scored = CONFIG.chainScore(length) * player.multiplier
    player.score += scored

    const neighbours = this.board.neighboursOf(chain)
    this.board.remove(chain)
    chain.forEach((dot, index) => {
      this.#release(dot)
      const at = this.dotPosition(dot)
      const previous = index > 0 ? chain[index - 1] : dot
      this.popping.push({
        x: at.x,
        y: at.y,
        colour: dot.colour,
        special: dot.special,
        index,
        axis: Math.atan2(dot.row - previous.row, dot.col - previous.col),
        // Only the dots still on the board flinch, so this is taken before the
        // gaps are closed.
        neighbours: index === length - 1 ? neighbours : [],
        at: index * CONFIG.POP_STAGGER,
        burst: false,
        // What was riding the dot. Nothing deals specials yet; when something
        // does, this is where one fires from.
        fired: false,
      })
    })

    const middle = chain[Math.floor(length / 2)]
    const at = this.dotPosition(middle)
    const colour = this.theme.dots[chain[0].colour % this.theme.dots.length].bright
    this.particles.floater(at.x, at.y, `+${scored}`, colour, clamp(length / 4, 1, 2.2))

    player.chain.length = 0
    if (length >= CONFIG.MULTIPLIER_CHAIN) {
      player.multiplier = Math.min(player.multiplier + 1, CONFIG.MULTIPLIER_MAX)
      Sound.multiplier(player.multiplier)
    } else {
      player.multiplier = 1
    }
    return scored
  }

  // Let a chain go without spending it. `quiet` skips the sound, for a chain
  // dropped because the game ended rather than because the player let go.
  #dropChain(player, quiet = false) {
    if (player.chain.length === 0) {
      return
    }
    for (const dot of player.chain) {
      this.#release(dot)
      dot.nudge(-CONFIG.WOBBLE_LINK * 0.4, 0)
    }
    player.chain.length = 0
    player.dragging = false
    if (!quiet) {
      Sound.cancel()
    }
  }

  cancelChain(playerIndex = 0) {
    const player = this.players[playerIndex]
    if (player) {
      this.#dropChain(player)
    }
  }

  // ---- input intents ------------------------------------------------------
  // A press starts a chain where there is none and spends it where there is: the
  // one button, and it never throws a chain away by accident.
  linkPress(playerIndex = 0) {
    if (this.page) {
      this.menuConfirm()
      return
    }
    const player = this.players[playerIndex]
    if (!player || this.busy) {
      return
    }
    if (player.chain.length === 0) {
      this.startChain(playerIndex)
      return
    }
    if (player.chain.length >= this.mode.minChain) {
      this.popChain(playerIndex)
    } else {
      this.#dropChain(player)
    }
  }

  moveCursor(playerIndex, dx, dy) {
    if (this.page) {
      if (dy !== 0) {
        this.menuMove(dy)
      } else if (dx !== 0) {
        this.menuAdjust(dx)
      }
      return
    }
    const player = this.players[playerIndex]
    if (!player) {
      return
    }
    const col = clamp(player.cursor.col + dx, 0, this.board.cols - 1)
    const row = clamp(player.cursor.row + dy, 0, this.board.rows - 1)
    if (col === player.cursor.col && row === player.cursor.row) {
      return
    }
    // A chain follows the cursor, so a move that the chain cannot make is refused
    // - except where the chain is a single dot and nothing has been invested in it
    // yet, which is dropped so the cursor can go and look elsewhere.
    if (player.chain.length > 0 && !this.extendTo(playerIndex, col, row)) {
      if (player.chain.length > 1) {
        return
      }
      this.#dropChain(player, true)
    }
    player.cursor.col = col
    player.cursor.row = row
  }

  // A pointer drags instead of stepping: down starts, move extends, up spends.
  pointerDown(playerIndex, cell) {
    if (this.page || !cell) {
      return
    }
    const player = this.players[playerIndex]
    if (!player || this.busy) {
      return
    }
    player.cursor.col = cell.col
    player.cursor.row = cell.row
    if (player.chain.length > 0) {
      this.#dropChain(player, true)
    }
    if (this.startChain(playerIndex)) {
      player.dragging = true
    }
  }

  pointerMove(playerIndex, cell) {
    const player = this.players[playerIndex]
    if (!player || !cell) {
      return
    }
    if (!player.dragging) {
      // Hovering still moves the cursor, so the mouse and the keyboard agree about
      // where the player is looking - which is what shows a special's blurb.
      if (!this.page) {
        player.cursor.col = cell.col
        player.cursor.row = cell.row
      }
      return
    }
    if (this.extendTo(playerIndex, cell.col, cell.row)) {
      player.cursor.col = cell.col
      player.cursor.row = cell.row
    }
  }

  pointerUp(playerIndex) {
    const player = this.players[playerIndex]
    if (!player || !player.dragging) {
      return
    }
    player.dragging = false
    if (player.chain.length >= this.mode.minChain) {
      this.popChain(playerIndex)
    } else {
      this.#dropChain(player, player.chain.length < 2)
    }
  }

  // What the cursor is over, if it is carrying a special: the view names it, which
  // is the whole of how a player learns what one does.
  hoveredSpecial(playerIndex = 0) {
    const player = this.players[playerIndex]
    if (!player || !this.board || this.page) {
      return null
    }
    const dot = this.board.at(player.cursor.col, player.cursor.row)
    return dot && dot.special ? SPECIAL_BY_ID.get(dot.special) : null
  }

  onBlur() {
    // A key that goes down and comes up while the window is elsewhere would
    // otherwise be stuck down. The chain is kept: it costs nothing and losing one
    // to an alt-tab would be a nasty surprise.
    for (const player of this.players) {
      player.dragging = false
    }
  }

  // ---- menus --------------------------------------------------------------
  // A page is a list of rows the view draws and the input layer walks. A row is
  // data: what it is called, what it currently says, and what kind of thing it is.
  // What each one does lives in #activate and #adjust, keyed by its id.
  menuRows() {
    switch (this.page) {
      case "title":
        return [
          { id: "start", label: "START", kind: "action" },
          {
            id: "mode",
            label: "MODE",
            value: this.mode.name,
            kind: "choice",
            hint: this.mode.blurb,
          },
          ...this.#settingRows(),
        ]
      case "pause":
        return [
          { id: "resume", label: "RESUME", kind: "action" },
          { id: "restart", label: "RESTART", kind: "action" },
          ...this.#settingRows(),
          { id: "title", label: "QUIT TO TITLE", kind: "action" },
        ]
      case "over": {
        const rows = []
        // A level lost is a puzzle got wrong: retrying it is what the player wants,
        // and starting from the first level again is offered underneath.
        if (this.currentLevel && this.outcome !== "won") {
          rows.push({
            id: "retry",
            label: "RETRY LEVEL",
            kind: "action",
            hint: `LEVEL ${this.level + 1}: ${this.currentLevel.name}`,
          })
        }
        rows.push({
          id: "again",
          label: this.currentLevel ? "START OVER" : "PLAY AGAIN",
          kind: "action",
        })
        rows.push({
          id: "mode",
          label: "MODE",
          value: this.mode.name,
          kind: "choice",
          hint: this.mode.blurb,
        })
        rows.push({ id: "title", label: "TITLE", kind: "action" })
        return rows
      }
      case "controls":
        return this.#controlRows()
      default:
        return []
    }
  }

  #settingRows() {
    return [
      { id: "theme", label: "THEME", value: this.theme.name, kind: "choice" },
      { id: "brightness", label: "BRIGHTNESS", value: this.brightness.name, kind: "choice" },
      { id: "sound", label: "SOUND", value: this.settings.sound ? "ON" : "OFF", kind: "choice" },
      { id: "controls", label: "CONTROLS", kind: "action" },
    ]
  }

  // One row per control per device, so both devices are configured from the same
  // page and it is obvious which is which.
  #controlRows() {
    const rows = []
    for (const device of BINDING_DEVICES) {
      rows.push({ id: `head:${device.id}`, label: device.name, kind: "heading" })
      for (const control of BINDABLE_CONTROLS) {
        if (control.defaults[device.id] === undefined) {
          continue
        }
        const waiting =
          this.rebinding &&
          this.rebinding.device === device.id &&
          this.rebinding.control === control.id
        rows.push({
          id: `bind:${device.id}:${control.id}`,
          label: control.name,
          value: waiting ? device.prompt : this.bindingLabel(device.id, control.id),
          kind: "binding",
        })
      }
    }
    rows.push({ id: "resetBindings", label: "RESET TO DEFAULTS", kind: "action" })
    rows.push({ id: "back", label: "BACK", kind: "action" })
    return rows
  }

  // What a binding is called on screen. A key code is trimmed to the part a player
  // recognises; a pad button is only ever an index, since the API never says what
  // is printed on it.
  bindingLabel(deviceId, controlId) {
    const value = this.bindings[deviceId][controlId]
    if (value === undefined) {
      return "-"
    }
    if (deviceId === "buttons") {
      return `BTN ${value}`
    }
    const keys = Array.isArray(value) ? value : [value]
    return keys.map(keyLabel).join(" / ")
  }

  menuMove(delta) {
    const rows = this.menuRows()
    if (rows.length === 0) {
      return
    }
    let index = this.menuIndex
    // Headings are labels rather than rows, so the cursor steps over them.
    for (let guard = 0; guard < rows.length; guard++) {
      index = (index + delta + rows.length) % rows.length
      if (rows[index].kind !== "heading") {
        break
      }
    }
    if (index !== this.menuIndex) {
      this.menuIndex = index
      Sound.menuMove()
    }
  }

  menuAdjust(delta) {
    const row = this.menuRows()[this.menuIndex]
    if (!row) {
      return
    }
    this.#adjust(row, delta)
  }

  menuConfirm() {
    const row = this.menuRows()[this.menuIndex]
    if (!row) {
      return
    }
    if (row.kind === "choice") {
      this.#adjust(row, 1)
      return
    }
    if (row.kind === "binding") {
      const [, device, control] = row.id.split(":")
      this.rebinding = { device, control }
      Sound.menuConfirm()
      return
    }
    this.#activate(row)
  }

  menuBack() {
    if (this.rebinding) {
      this.cancelRebind()
      return
    }
    if (this.page === "controls") {
      this.#closePage()
      return
    }
    if (this.page === "pause") {
      this.page = null
      Sound.menuBack()
      return
    }
    if (this.page === "over") {
      this.toTitle()
      Sound.menuBack()
    }
  }

  // The one key that always does the sensible thing: abandons a rebind, closes a
  // menu, or opens the pause menu mid-game.
  escape() {
    if (this.rebinding) {
      this.cancelRebind()
      return
    }
    if (this.page) {
      this.menuBack()
      return
    }
    this.togglePause()
  }

  // The menu key: opens the pause page mid-game and closes it again.
  togglePause() {
    if (this.phase !== PHASE.PLAYING) {
      return
    }
    if (this.page === "pause") {
      this.page = null
      Sound.menuBack()
    } else if (this.page == null) {
      this.page = "pause"
      this.menuIndex = 0
      Sound.menuConfirm()
    }
  }

  #openPage(page) {
    this.pageReturn = this.page
    this.page = page
    // A page whose first row is a heading - the controls page - would otherwise
    // open with the cursor on a label that does nothing when pressed.
    this.menuIndex = Math.max(
      this.menuRows().findIndex((row) => row.kind !== "heading"),
      0,
    )
  }

  #closePage() {
    this.page = this.pageReturn ?? (this.phase === PHASE.PLAYING ? "pause" : "title")
    this.pageReturn = null
    this.menuIndex = 0
    this.rebinding = null
    Sound.menuBack()
  }

  #activate(row) {
    switch (row.id) {
      case "start":
      case "again":
        Sound.menuConfirm()
        this.start(this.mode.id)
        break
      case "retry":
        Sound.menuConfirm()
        this.retryLevel()
        break
      case "restart":
        Sound.menuConfirm()
        this.start(this.mode.id)
        break
      case "resume":
        this.page = null
        Sound.menuBack()
        break
      case "title":
        Sound.menuBack()
        this.toTitle()
        break
      case "controls":
        Sound.menuConfirm()
        this.#openPage("controls")
        break
      case "resetBindings":
        this.bindings = freshBindings()
        saveBindings(this.bindings)
        Sound.menuConfirm()
        break
      case "back":
        this.#closePage()
        break
      default:
        break
    }
  }

  #adjust(row, delta) {
    switch (row.id) {
      case "mode": {
        const index = GAME_MODES.indexOf(this.mode)
        const next = GAME_MODES[(index + delta + GAME_MODES.length) % GAME_MODES.length]
        this.mode = next
        this.settings.mode = next.id
        this.layout = boardLayout(next.cols, next.rows)
        this.#storeSettings()
        // The menu blips are in the mode's own tuning, so scrolling the list is also
        // hearing what each one sounds like.
        this.tuning = resolveTuning(next.tuning)
        Sound.setTuning(this.tuning)
        // The board behind the title is the mode being chosen, so it changes with
        // it: a nine across board looks different before it is started.
        if (this.phase !== PHASE.PLAYING) {
          this.dealAttractBoard()
        }
        Sound.menuMove()
        break
      }
      case "theme": {
        const index = THEME_IDS.indexOf(this.settings.theme)
        this.settings.theme = THEME_IDS[(index + delta + THEME_IDS.length) % THEME_IDS.length]
        this.#storeSettings()
        Sound.menuMove()
        break
      }
      case "brightness": {
        const levels = CONFIG.BRIGHTNESS_LEVELS
        this.settings.brightness = clamp(this.settings.brightness + delta, 0, levels.length - 1)
        this.#storeSettings()
        Sound.menuMove()
        break
      }
      case "sound":
        this.setSound(!this.settings.sound)
        break
      default:
        break
    }
  }

  setSound(on) {
    this.settings.sound = on
    Sound.enabled = on
    this.#storeSettings()
    if (on) {
      Sound.menuConfirm()
    }
  }

  setTheme(id) {
    if (THEMES[id]) {
      this.settings.theme = id
      this.#storeSettings()
    }
  }

  stepBrightness(delta = 1) {
    const levels = CONFIG.BRIGHTNESS_LEVELS
    this.settings.brightness = (this.settings.brightness + delta + levels.length) % levels.length
    this.#storeSettings()
  }

  // ---- rebinding ----------------------------------------------------------
  // A row waiting for input takes the next key or button that is not reserved.
  // Whatever else held that control loses it, so two controls can never share one.
  captureBinding(deviceId, value) {
    if (!this.rebinding || this.rebinding.device !== deviceId) {
      return false
    }
    if (deviceId === "keys" && RESERVED_KEYS.has(value)) {
      return false
    }
    if (deviceId === "buttons" && RESERVED_BUTTONS.has(value)) {
      return false
    }
    const table = this.bindings[deviceId]
    for (const control of Object.keys(table)) {
      if (control === this.rebinding.control) {
        continue
      }
      const held = table[control]
      if (Array.isArray(held)) {
        const filtered = held.filter((entry) => entry !== value)
        table[control] = filtered.length > 0 ? filtered : []
      } else if (held === value) {
        delete table[control]
      }
    }
    table[this.rebinding.control] = deviceId === "keys" ? [value] : value
    this.rebinding = null
    saveBindings(this.bindings)
    Sound.menuConfirm()
    return true
  }

  cancelRebind() {
    if (this.rebinding) {
      this.rebinding = null
      Sound.menuBack()
    }
  }
}

// A key code as a player would recognise it: the code without its category, so
// "KeyW" reads as W and "ArrowLeft" as LEFT.
export function keyLabel(code) {
  if (code.startsWith("Key")) {
    return code.slice(3)
  }
  if (code.startsWith("Digit")) {
    return code.slice(5)
  }
  if (code.startsWith("Arrow")) {
    return code.slice(5).toUpperCase()
  }
  if (code.startsWith("Numpad")) {
    return `NUM ${code.slice(6)}`
  }
  return code.toUpperCase()
}
