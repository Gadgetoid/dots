// The game: phases, the chain rules as the player experiences them, scoring, the
// menus and the settings. It owns a Board and a Particles, and it never draws.
//
// Chain state is per player, not per game. One player is the only case there is
// today, but a chain, a cursor, a score and a multiplier all belong to whoever is
// holding them, and a dot records which player's chain has claimed it - so a
// second pad is a second entry in `players` and not a second copy of all of
// this. Every input method therefore takes a player index, and defaults to the
// first.

import { Board } from "./board.js"
import { Particles } from "./particles.js"
import { Sound } from "./audio.js"
import { Speech } from "./speech.js"
import { GAME_MODES, SEEDED_MODE, modeById, defaultOutcome, modeRefills } from "./modes/index.js"
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
  prefersReducedMotion,
  MENU_NOTES,
  MENU_STEP,
  LEVEL_COLUMNS,
  REDUCED_MOTION_RATE,
  PAGE_TITLES,
  OUTCOMES,
  turnsText,
} from "./config.js"
import { THEMES, THEME_IDS, DOT_SHAPES } from "./palette.js"
import { FONTS, fontById, fontReady, ensureFont } from "./fonts.js"
import { resolveTuning } from "./scales.js"
import { clamp, lerp, mulberry32 } from "./math.js"
import { parseLink, levelFromToken } from "./link.js"
import {
  SEED_DOTS,
  SEED_COLOURS,
  coloursFromSeed,
  seedFromColours,
  seedCode,
  seedFromCode,
  randomSeed,
  dailySeed,
  validSeed,
} from "./seed.js"
import {
  loadBest,
  saveBest,
  loadProgress,
  saveProgress,
  loadSettings,
  saveSettings,
  loadBindings,
  saveBindings,
  loadSeedBest,
  saveSeedBest,
} from "./persistence.js"

export const PHASE = { TITLE: "title", PLAYING: "playing", OVER: "over" }

// How many players the input layer may hand out slots to. One is played today; the
// state is per player throughout so raising this is a matter of assigning devices.
export const MAX_PLAYERS = 4

// How loud a landing has to be to be worth a sound, and how many of them may be
// voiced in one frame: a refilled board lands a dozen dots at once, and playing
// all of them is a clatter, not a rain.
const LAND_AUDIBLE = 6
const LAND_VOICES = 3

// Pages opened from another page, so back closes them and returns where they came from.
// Anything else back does is decided by the phase; see Game.menuBack.
const NESTED_PAGES = new Set(["controls", "settings", "modes", "levels", "seed"])

// The least time between two refusals being sounded. See Game.#soundBlocked.
const BLOCKED_GAP = 0.18

export class Player {
  constructor(index) {
    this.index = index
    this.score = 0
    this.multiplier = 1
    this.cursor = { col: 0, row: 0 }
    // The dots being held, in the order they were linked.
    this.chain = []
    // The drawn glow, chasing what the chain's length is worth, so it builds and
    // fades instead of stepping.
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
    // How far each mode with levels has got: see levelBest.
    this.progress = {}
    // Best score per seed code, for the seeded mode: see seedBestFor.
    this.seedBest = {}
    // The seed the current game was dealt from, and what the picker's dots are showing.
    // Two, because the picker is data rebuilt every frame and cannot hold a draft of its
    // own, and because walking away from the picker must not change the board being played.
    // Both open on today's, which is what a player who wants a board to share wants.
    this.seed = dailySeed()
    this.seedDraft = this.seed
    this.phase = PHASE.TITLE
    // Which menu is open, or null while the board is being played. The title and
    // the game-over screen are menus like any other, which is why a press does the
    // same thing on all three.
    this.page = "title"
    this.pageReturn = null
    // Two cursors: which row, and which cell of that row.
    this.menuIndex = 0
    this.menuOption = 0
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
    // Chains spent this game, and how many had been spent when the current level was
    // dealt: a level's turns are its own, the way its score is. What a board cost as
    // against what it paid, which is the other half of how well it was played.
    this.turns = 0
    this.levelStartTurns = 0
    // A line over the board for a moment, for the one thing a game that opens without a
    // title screen would otherwise never say. See #welcome.
    this.banner = null
    // The level just cleared, while its page is up: see #levelCleared.
    this.cleared = null
    // Seconds since anything was picked up or spent, and what the board is pointing at
    // because of it. See #advanceHint.
    this.sinceMove = 0
    this.hint = null
    // When a refused move was last sounded, so holding a direction against the edge of the
    // board does not rattle.
    this.blockedAt = -1
    // What speech has already been told about, so a page or a banner is announced when it
    // changes and not every frame it is up. See #announce.
    this.spokenPage = null
    this.spokenBanner = null
    // A line on a page explaining why it is the page being looked at, for the one case that
    // needs it: a link to a puzzle nobody has reached yet. Lasts as long as the visit.
    this.notice = null
    // Whether anything was remembered about this player. What tells a first-time player from
    // one who last played whatever the default happens to be.
    this.remembered = false
    this.launched = false

    this.applySettings()
    this.dealAttractBoard()
    this.#resetMenuCursor()
    // Held, because what opens depends on it: which puzzle levels are unlocked is part of
    // what was remembered, and a link may name one. See launch.
    this.restored = this.#restoreState()
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

  // A chain is held for as long as the button is, and spent when it comes up. The other
  // way round - a press to start and another to spend - is the accessible setting, for
  // anyone who would rather not hold a button while doing anything else with the hand.
  get holdToLink() {
    return this.settings.link !== "toggle"
  }

  // No particles, a slower fall and solid menus. Motion and transparency are the two things
  // a person is most likely to need less of, and neither carries anything the game needs to
  // say. A hint is the one movement that does carry something, so it is not turned off:
  // it rings instead of wobbling.
  //
  // The browser is asked while nothing has been chosen here, which is what the "auto"
  // setting is. Everything drawn and everything stepped comes off this one getter, so the
  // system preference reaches all of it without anything else knowing where it came from.
  get reducedMotion() {
    if (this.settings.motion === "auto") {
      return prefersReducedMotion()
    }
    return this.settings.motion === "reduced"
  }

  // Whether a settled board points out a move when nothing has happened for a while.
  get hintsOn() {
    return this.settings.hints !== "off"
  }

  // Whether the menus read themselves out. See speech.js for why this can only ever be
  // something the player asks for.
  get speechOn() {
    return this.settings.speech === "on"
  }

  // What a finished board is told it did, which the game-over page prints and, with
  // speech on, says.
  get outcomeText() {
    if (this.outcome === "won" && this.levels) {
      return OUTCOMES.levels
    }
    return OUTCOMES[this.outcome] || "Game over"
  }

  // The face to draw text in. A face that has been chosen but has not arrived yet falls back
  // to the standard one, so a frame is never drawn in whatever the browser picks for a family
  // it does not have.
  get font() {
    const wanted = fontById(this.settings.font)
    return fontReady(wanted.id) ? wanted : FONTS[0]
  }

  // The shape a dot of this colour carries, or null while shapes are off. A second signal
  // for anyone who cannot rely on the colours; see DOT_SHAPES.
  shapeFor(colour) {
    if (this.settings.shapes !== "on") {
      return null
    }
    return DOT_SHAPES[colour % DOT_SHAPES.length] || null
  }

  // Hand the settings that belong to something else to the thing that owns them. Called
  // when the settings are first taken up and again when storage answers: a first run has
  // nothing stored, and without this it would play silently while its own settings page
  // said the sound was on. Nothing is heard until the first key or touch either way, since
  // that is the gesture a browser wants before it will open an audio device.
  applySettings() {
    Sound.enabled = this.settings.sound
    Speech.setEnabled(this.settings.speech === "on")
    // A remembered face has to be asked for again: nothing is bundled into the page, so a
    // returning player's choice is a fetch like any other. The `font` getter draws in the
    // standard one until it lands.
    ensureFont(this.settings.font)
  }

  // ---- persistence --------------------------------------------------------
  // Read back what was remembered. Never rejects: launch waits on this, and a game that
  // never opened because storage misbehaved would be worse than one that forgot everything.
  async #restoreState() {
    let settings = null
    let bindings = null
    let best = null
    let progress = null
    let seedBest = null
    try {
      ;[settings, bindings, best, progress, seedBest] = await Promise.all([
        loadSettings(),
        loadBindings(),
        loadBest(),
        loadProgress(),
        loadSeedBest(),
      ])
    } catch {
      /* ignore */
    }
    if (settings) {
      this.remembered = true
      this.settings = { ...this.settings, ...settings }
      this.applySettings()
      // Storage answers a frame or two in, by which time a board has already been
      // dealt for the title: deal the remembered mode's instead.
      if (this.phase === PHASE.TITLE && !this.launched) {
        this.mode = modeById(this.settings.mode)
        this.layout = boardLayout(this.mode.cols, this.mode.rows)
        // The code last played, so the picker is offered their own board and not a
        // stranger's.
        if (validSeed(this.settings.seed)) {
          this.seedDraft = this.settings.seed
        }
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
    if (progress) {
      this.progress = progress
    }
    if (seedBest) {
      this.seedBest = seedBest
    }
  }

  #storeSettings() {
    saveSettings({ ...this.settings })
  }

  // ---- lifecycle ----------------------------------------------------------
  // Which authored level is being played, or null in a mode that deals its own.
  get currentLevel() {
    const levels = this.levels
    if (!levels || levels.length === 0) {
      return null
    }
    return levels[clamp(this.level, 0, levels.length - 1)]
  }

  // ---- seeds --------------------------------------------------------------
  // The code the board in play was dealt from, or the one the picker is holding where
  // nothing has been dealt from a code at all.
  get seedText() {
    return seedCode(this.seed)
  }

  // The best score on a code. This is the figure worth comparing with another player: a
  // score is only a score against the board it was made on.
  seedBestFor(seed = this.seed) {
    return this.seedBest[seedCode(seed)] ?? 0
  }

  // The record the game in progress is played against: the code's own where the board came
  // from one, and the mode's otherwise.
  get bestScore() {
    return this.mode.seeded ? this.seedBestFor() : this.best[this.mode.id] || 0
  }

  #recordSeed(seed, scored) {
    const code = seedCode(seed)
    if (this.seedBest[code] >= scored) {
      return
    }
    this.seedBest = { ...this.seedBest, [code]: scored }
    saveSeedBest({ ...this.seedBest })
  }

  // Take a code into the picker and deal the board it names behind the panel. Walking a code
  // is seeing the board it gives, the way walking the mode grid is seeing the mode; the deal
  // is skipped mid-game for the reason #previewMode gives.
  #showSeed(seed) {
    this.seedDraft = seed
    if (this.phase !== PHASE.PLAYING) {
      this.dealAttractBoard()
    }
  }

  #stepSeedDot(index, colour) {
    const colours = coloursFromSeed(this.seedDraft)
    colours[index] = (colour + SEED_COLOURS) % SEED_COLOURS
    this.#showSeed(seedFromColours(colours))
  }

  // A digit typed straight into the code, which is how a code somebody sent is entered
  // without pressing a dot round the colours one at a time. Returns whether the character
  // was one a code holds, so the input layer knows whether to keep the key, and moves along
  // so six presses type a whole code.
  typeSeedDigit(character) {
    if (!this.typingSeed) {
      return false
    }
    const digit = Number(character)
    if (!Number.isInteger(digit) || digit < 1 || digit > SEED_COLOURS) {
      return false
    }
    this.#stepSeedDot(this.menuOption, digit - 1)
    this.menuOption = (this.menuOption + 1) % SEED_DOTS
    this.#playCursor()
    return true
  }

  // Whether a typed digit has somewhere to go: the code under the cursor, and nothing else
  // in the game takes characters.
  get typingSeed() {
    const row = this.menuRows()[this.menuIndex]
    return Boolean(row && row.layout === "seed")
  }

  // A code put in front of the player without being played: the picker opens on it, so the
  // page can name the board and what it has already given up. Returns whether it was a code.
  openSharedSeed(code) {
    const seed = seedFromCode(code)
    if (seed === null || !SEEDED_MODE) {
      return false
    }
    this.#previewMode(SEEDED_MODE)
    this.#showSeed(seed)
    this.#openPage("seed")
    return true
  }

  // ---- opening the game ---------------------------------------------------
  // What the game opens on, called once with the query string it was opened with.
  //
  // A link names it where there is one; otherwise a player carries on with what they were
  // playing, and a player with nothing remembered gets the board of the day. Either way it
  // opens in the game and not on a menu: the title screen is a page to be left, and a game
  // that starts playing has already said everything a title screen would.
  //
  // Waits on `restored` rather than running from the constructor, because what is unlocked
  // decides whether a link to a puzzle can be honoured, and that arrives from storage a
  // frame or two in.
  launch(search = "") {
    if (this.launched) {
      return
    }
    this.launched = true
    const wanted = parseLink(
      search,
      GAME_MODES.map((mode) => mode.id),
    )
    if (wanted && this.#openLink(wanted)) {
      return
    }
    // Nothing asked for, or nothing that could be honoured. A first-time player has no mode
    // to carry on with, and the board of the day is the one worth handing them.
    const mode = this.remembered ? modeById(this.settings.mode) : SEEDED_MODE || this.mode
    this.#openMode(mode)
  }

  // Where a link's level token points, over every set the mode has: the level's index and which
  // set holds it, or null for a token no set knows. Level names are unique across the sets, so a
  // link needs no set of its own and one written before the second set existed still opens the
  // board it names. A number is looked for in the set being played first, since a number means a
  // position on the ladder in front of you.
  #levelFromLink(mode, token) {
    const sets = this.levelSetsFor(mode.id)
    if (!sets) {
      const level = levelFromToken(mode.levels || [], token)
      return level === null ? null : { level, set: null }
    }
    const first = clamp(this.settings.levelSet, 0, sets.length - 1)
    const order = [first, ...sets.map((_, at) => at).filter((at) => at !== first)]
    for (const at of order) {
      const level = levelFromToken(sets[at].levels, token)
      if (level !== null) {
        return { level, set: at }
      }
    }
    return null
  }

  // Act on a link. Returns whether it was honoured; a link this refuses falls back on what
  // the player was doing, having said why where the reason is worth saying.
  #openLink(wanted) {
    const mode = modeById(wanted.mode)
    if (mode.levels && wanted.puzzle !== null) {
      const found = this.#levelFromLink(mode, wanted.puzzle)
      if (found === null) {
        return false
      }
      // The set that holds the level becomes the set being played, so a link names a board rather
      // than a position and opens it whichever ladder the player was last on.
      if (found.set !== null) {
        this.settings.levelSet = found.set
        this.#storeSettings()
      }
      const level = found.level
      if (!this.levelUnlocked(level, mode.id)) {
        // Refused, and said so: the picker draws padlocks and opens on the furthest level
        // reached, so all this has to add is which level was asked for.
        this.mode = mode
        this.layout = boardLayout(mode.cols, mode.rows)
        this.#dealBoard()
        this.#openPage("levels")
        this.notice = `${this.levelsFor(mode.id)[level].name} is locked, clear the one before it`
        return true
      }
      this.start(mode.id, { level })
      return true
    }
    this.#openMode(mode, wanted.seed)
    return true
  }

  // Start a mode where a link or a returning player named it but not a board.
  //
  // A seeded mode opens on today's board unless a code was named. Coming back to the game is
  // coming back to the board everyone else is on, not to the one left behind: the code that
  // was being played is in the address bar, which is what brings a player back to it.
  #openMode(mode, seed = "today") {
    const options = {}
    if (mode.seeded) {
      options.seed = seed === "today" ? dailySeed() : seed
    }
    if (mode.levels) {
      options.level = this.furthestLevel(mode.id)
    }
    this.start(mode.id, options)
    if (!this.remembered) {
      this.#welcome()
    }
  }

  // The one thing the title screen said that a player who never sees it would miss.
  #welcome() {
    this.banner = {
      text: "Link dots of a colour to pop them",
      sub: this.inputMode === "gamepad" ? "Stick moves, A pops" : "Arrows move, space pops",
      age: 0,
      life: 4.5,
    }
  }

  // ---- authored levels ----------------------------------------------------
  // A mode may hold more than one set of levels, and the puzzle mode holds two: which one is being
  // played is a thing the player chooses, so it lives here rather than on the mode, and it is
  // remembered with the settings. One index across the game, since only one mode has sets; a second
  // such mode would want one each.
  levelSetsFor(modeId = this.mode.id) {
    return modeById(modeId).sets || null
  }

  levelSetFor(modeId = this.mode.id) {
    const sets = this.levelSetsFor(modeId)
    return sets ? sets[clamp(this.settings.levelSet, 0, sets.length - 1)] : null
  }

  get levelSet() {
    return this.levelSetFor()
  }

  // The set the picker's button offers, or null in a mode with only one. Two sets, so it is the
  // other one; more would make this the next one round.
  get otherLevelSet() {
    const sets = this.levelSetsFor()
    if (!sets || sets.length < 2) {
      return null
    }
    return sets[(clamp(this.settings.levelSet, 0, sets.length - 1) + 1) % sets.length]
  }

  // The levels in play: the current set's, or the mode's own where it has no sets. Everything that
  // asks what the levels are asks this, since `mode.levels` cannot know which set is up.
  levelsFor(modeId = this.mode.id) {
    return this.levelSetFor(modeId)?.levels ?? modeById(modeId).levels ?? null
  }

  get levels() {
    return this.levelsFor()
  }

  // Where a set's progress is kept. The first set of a mode carries the bare mode id, because that
  // is the key every player who has ever cleared a level already has one under; a set added later
  // carries its own, so the two ladders remember separately.
  progressKey(modeId = this.mode.id) {
    return this.levelSetFor(modeId)?.progress ?? modeId
  }

  // The best score on each level of a mode with them, as { [index]: score }. A level with a
  // record has been cleared, which is what opens the one after it, and how that score
  // compares with the level's par is what says whether it was cleared for a star.
  levelBest(modeId = this.mode.id) {
    return this.progress[this.progressKey(modeId)] || {}
  }

  // Whether this level may be played. The first always; after that, only once the one
  // before it has been cleared. A level nobody has reached is not a level to be dropped
  // into, since the whole mode is one board leading to the next.
  levelUnlocked(index, modeId = this.mode.id) {
    if (index <= 0) {
      return true
    }
    return this.levelBest(modeId)[index - 1] !== undefined
  }

  levelCleared(index, modeId = this.mode.id) {
    return this.levelBest(modeId)[index] !== undefined
  }

  // The furthest level reached, which is where a mode of them carries on from. The picker
  // opens its cursor here too; see #firstOption.
  furthestLevel(modeId = this.mode.id) {
    const levels = this.levelsFor(modeId) || []
    let furthest = 0
    for (let index = 1; index < levels.length; index++) {
      if (this.levelUnlocked(index, modeId)) {
        furthest = index
      }
    }
    return furthest
  }

  // Whether this level has been cleared for everything it is worth. The par is exact - it is
  // the most any clearing order pays - so this is a real mark and not a threshold somebody
  // picked.
  levelStarred(index, modeId = this.mode.id) {
    // Only where there was a star to be had. Clearing a level whose every order pays the same
    // is not an achievement, so those have no star at all.
    if (!this.levelContested(index, modeId)) {
      return false
    }
    const level = this.levelsFor(modeId)[index]
    const scored = this.levelBest(modeId)[index]
    return scored !== undefined && scored >= level.par
  }

  // Whether how a level is played changes what it pays at all. Where the least any clearing
  // order scores is also the most, there is nothing to aim at and no star to miss: the picker
  // marks the others so a player knows which ones have something in them.
  levelContested(index, modeId = this.mode.id) {
    const levels = this.levelsFor(modeId)
    const level = levels && levels[index]
    return Boolean(level && level.par && level.floor !== undefined && level.floor < level.par)
  }

  // Write down what a level paid, if it is the most it has paid. Returns whether that
  // cleared it for a star, which is what the banner says.
  #recordLevel(index, scored) {
    const modeId = this.mode.id
    const key = this.progressKey(modeId)
    const kept = { ...(this.progress[key] || {}) }
    if (!(kept[index] >= scored)) {
      kept[index] = scored
    }
    this.progress = { ...this.progress, [key]: kept }
    saveProgress({ ...this.progress })
    return this.levelStarred(index, modeId)
  }

  // What has been scored on the level being played, as against what it could be. The
  // score itself carries across levels, so the running total is no use as a target: a
  // level's par is only comparable with what that level has paid.
  get levelScore() {
    return this.player.score - this.levelStartScore
  }

  // And what it has cost, for the same reason: turns carry across levels too.
  get levelTurns() {
    return this.turns - this.levelStartTurns
  }

  get levelPar() {
    const level = this.currentLevel
    return level && level.par ? level.par : 0
  }

  get lastLevel() {
    const levels = this.levels
    return !levels || this.level >= levels.length - 1
  }

  // ---- what is being played, in words ------------------------------------
  // Which board this is, for a mode where a board has a name: which puzzle of how many, or
  // which code. Null for a mode that deals its own, where there is nothing to name.
  get boardName() {
    const level = this.currentLevel
    if (level) {
      // Counted off the set being played and not off `mode.levels`, which is only ever the
      // first set: see levelsFor. And named with it, the way the picker's own heading is,
      // since one ladder's third board and another's are both "3" and a paused game is
      // exactly where that has to be unambiguous.
      //
      // Not "Puzzle 1 of 52": the mode's own name is the line above this one wherever this is
      // used, and read out it came to "Puzzle. Puzzle 1 of 52."
      const set = this.levelSet
      const which = `${this.level + 1} of ${this.levels.length}, ${level.name}`
      return set ? `${set.name}: ${which}` : which
    }
    if (this.mode.seeded) {
      return `Code ${this.seedText}`
    }
    return null
  }

  // What has been scored, against whatever this board is worth comparing with: a level's par,
  // or the record for the mode or the code. Both the pause page and its announcement come off
  // this, so a player who cannot see the score can pause and be told it.
  get scoreLine() {
    if (this.currentLevel && this.levelPar > 0) {
      return `Scored ${this.levelScore} of ${this.levelPar}`
    }
    const best = this.bestScore
    const scored = `Scored ${this.player.score}`
    return best > 0 ? `${scored}, best ${best}` : scored
  }

  // What it has cost, in chains spent: the level's own where a level is being played, since
  // the score beside it is the level's too.
  get turnsLine() {
    return turnsText(this.currentLevel ? this.levelTurns : this.turns)
  }

  // A board for the title screen to sit over, so the game shows itself instead of offering a
  // menu on an empty field. It is dealt and left alone: nothing is
  // playing it, and starting a mode deals a fresh one.
  dealAttractBoard() {
    this.#dealBoard()
  }

  // The seed the next board is dealt from: the one the game in progress is on, and what the
  // picker is holding while nothing is being played, so the field behind the panel shows the
  // board the code in front of it names.
  get #dealSeed() {
    return this.phase === PHASE.PLAYING ? this.seed : this.seedDraft
  }

  #freshBoard() {
    return new Board({
      cols: this.mode.cols,
      rows: this.mode.rows,
      minChain: this.mode.minChain,
      colours: this.mode.colours,
      pickColour: this.mode.pickColour ? this.mode.pickColour.bind(this.mode) : null,
      specialChance: this.mode.specialChance,
      // A mode that plays from a code is dealt by a generator started from it, and a fresh
      // generator every deal: that is what makes a restart the same board again, and it is
      // what the 32blit version did by resetting its PRNG as it loaded one. Nothing else is
      // seeded, since a spark landing in the same place twice is not what anyone means by
      // the same board.
      random: this.mode.seeded ? mulberry32(this.#dealSeed) : Math.random,
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

  start(modeId = this.settings.mode, options = {}) {
    this.mode = modeById(modeId)
    this.settings.mode = this.mode.id
    // Which code this board is dealt from. Restart and Again name none, so the one in play
    // carries and a re-deal is the same board to have another go at; starting the mode from
    // its picker names what the picker was holding. Remembered, so the picker opens on it
    // again next session.
    if (this.mode.seeded) {
      this.seed = validSeed(options.seed) ? options.seed : this.seed
      this.seedDraft = this.seed
      this.settings.seed = this.seed
    }
    this.#storeSettings()
    this.layout = boardLayout(this.mode.cols, this.mode.rows)
    // What the mode sounds like. Resolved per game, not held on the mode: a mode may ask for
    // a random tuning, and then it is a different one each session.
    this.tuning = resolveTuning(this.mode.tuning)
    Sound.setTuning(this.tuning)
    // Where to begin, for a mode with levels: the one asked for if it has been reached, and
    // the first otherwise. Gated here as well as in the picker, so nothing can be dropped
    // into a level by asking for it.
    const wanted = Number(options.level) || 0
    const levels = this.levels
    this.level =
      levels && this.levelUnlocked(wanted, this.mode.id) ? clamp(wanted, 0, levels.length - 1) : 0
    this.levelStartScore = 0
    this.turns = 0
    this.levelStartTurns = 0
    this.banner = null
    this.cleared = null
    this.notice = null
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
    this.sinceMove = 0
    this.hint = null
    this.phase = PHASE.PLAYING
    this.page = null
    this.menuIndex = 0
    this.menuOption = 0
  }

  toTitle() {
    this.phase = PHASE.TITLE
    this.page = "title"
    this.rebinding = null
    // Whatever the last board had to say is not the title screen's to say: a level cleared
    // belongs to the game that cleared it.
    this.banner = null
    this.cleared = null
    this.notice = null
    this.dealAttractBoard()
    this.#resetMenuCursor()
  }

  // A level cleared: written down, and then held up on a page of its own.
  //
  // A page rather than the line this used to be. A level cleared short of its par is a
  // level worth another go, and that is a question to be asked and answered - a line that
  // fades while the next board drops in behind it can only be read. It is also where the
  // star has room to be drawn at a size worth earning.
  #levelCleared() {
    const level = this.currentLevel
    const scored = this.levelScore
    const starred = this.#recordLevel(this.level, scored)
    // Nothing is held - the board is empty - but the glow the last chain left is still
    // fading, and a pointer that was dragging has nothing under it now.
    for (const player of this.players) {
      player.glow = 0
      player.dragging = false
    }
    this.cleared = {
      name: level.name,
      scored,
      par: level.par || 0,
      turns: this.levelTurns,
      starred,
      // Whether there was a star to be had at all: a level every order pays the same for
      // has none, so it is not drawn as one missed. See levelContested.
      contested: this.levelContested(this.level),
      last: this.lastLevel,
      // How far into the drawn star's flight this is; see GameView's cleared heading.
      age: 0,
    }
    this.page = "cleared"
    this.#resetMenuCursor()
    Sound.clear()
  }

  // On to the next authored level, keeping the score, or off the end of the ladder: having
  // cleared them all is the one thing in this game that can be won.
  #continueLevel() {
    this.cleared = null
    if (this.lastLevel) {
      this.#finish("won")
      return
    }
    this.level++
    this.levelStartScore = this.player.score
    this.levelStartTurns = this.turns
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
    this.page = null
    this.menuIndex = 0
    this.menuOption = 0
  }

  // Deal the current level again, at the score it was dealt at. A level with no
  // moves left is a puzzle got wrong and not a game over, so this is what the
  // game-over screen offers instead of starting from the first one.
  retryLevel() {
    if (!this.currentLevel) {
      this.start(this.mode.id)
      return
    }
    this.player.score = this.levelStartScore
    this.turns = this.levelStartTurns
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
    this.cleared = null
    this.phase = PHASE.PLAYING
    this.page = null
    this.menuIndex = 0
    this.menuOption = 0
  }

  #finish(outcome) {
    this.outcome = outcome
    this.phase = PHASE.OVER
    this.page = "over"
    this.cleared = null
    this.#resetMenuCursor()
    for (const player of this.players) {
      this.#dropChain(player, true)
    }
    const score = this.player.score
    if (!(this.best[this.mode.id] >= score)) {
      this.best[this.mode.id] = score
      saveBest({ ...this.best })
    }
    // And against the code as well, where the board came from one: the mode's record is the
    // best board anyone was ever dealt, and a code's is the only figure two players can hold
    // up against each other.
    if (this.mode.seeded) {
      this.#recordSeed(this.seed, score)
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
    this.#announce()
    // Score still floats up off a chain in a reduced-motion session, but it stays where
    // it was spent instead of rising: it is the one particle carrying information.
    this.particles.motion = this.reducedMotion ? 0 : 1
    this.particles.step(dt)
    if (this.banner) {
      this.banner.age += dt
      if (this.banner.age >= this.banner.life) {
        this.banner = null
      }
    }
    // The cleared page's star flies in rather than appearing. Aged here with the banner,
    // ahead of the early return a page makes, since the page it is on is the one thing
    // still moving while it is up.
    if (this.cleared) {
      this.cleared.age += dt
    }
    if (!this.board) {
      return
    }
    if (this.page) {
      // A menu leaves the board alone but keeps it breathing, so the field behind
      // the panel is not a still image. Landings are not voiced, since nothing the
      // board does behind a panel is being played.
      this.board.step(dt * this.#boardRate)
      this.#advanceGlow(dt * 2)
      this.#ageHint(dt)
      return
    }
    this.#advanceBoard(dt)
    this.#advancePopping(dt)
    this.#advanceGlow(dt)
    this.#advanceChainTrail(dt)
    this.#advanceHint(dt)
    if (this.mode.timeLimit > 0 && this.outcome == null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt)
      if (this.timeLeft === 0) {
        this.#finish("timeup")
        return
      }
    }
    this.#advanceOutcome(dt)
  }

  // How fast the board's own clock runs. A reduced-motion session runs it slower, which
  // slows the fall and everything that falls out of it - the bounce, the wobble ringing
  // down - without the board knowing anything about a setting.
  get #boardRate() {
    return this.reducedMotion ? REDUCED_MOTION_RATE : 1
  }

  #advanceBoard(dt) {
    // Landings are collected and voiced together, so a whole refilled board is one soft rain
    // instead of a dozen overlapping knocks.
    let voices = 0
    this.board.step(dt * this.#boardRate, (dot, speed) => {
      if (speed >= LAND_AUDIBLE && voices < LAND_VOICES) {
        voices++
        Sound.land(clamp(speed / 22, 0.3, 1.4))
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
        if (!this.reducedMotion) {
          this.particles.pop(
            going.x,
            going.y,
            theme.bright,
            this.layout.radius / 30,
            this.layout.radius,
          )
        }
        Sound.pop(going.index)
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
    if (this.reducedMotion) {
      return
    }
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

  // A board that has been sat in front of for a while points something out. The wobble is
  // what does the pointing: it is the only movement left on the board that means anything,
  // which is exactly what makes it useful here and what made it noise on a landing.
  //
  // Where motion has been turned down there is no wobble to use, so the same hint is a
  // ring around each dot instead - the view draws whichever the settings allow.
  // A ring fades on its own clock, which runs whether or not a menu is over the board: it
  // is drawn behind the panel, and the wobble half of the same hint rings down there
  // anyway, since that is the board's own business.
  #ageHint(dt) {
    if (!this.hint) {
      return
    }
    this.hint.age += dt
    if (this.hint.age >= CONFIG.HINT_RING_LIFE) {
      this.hint = null
    }
  }

  #advanceHint(dt) {
    this.#ageHint(dt)
    if (!this.hintsOn || this.busy || !this.board.settled || this.outcome != null) {
      return
    }
    // A chain in hand is a player who is mid-thought, not one who is stuck.
    if (this.players.some((player) => player.chain.length > 0)) {
      this.sinceMove = 0
      return
    }
    this.sinceMove += dt
    if (this.sinceMove < CONFIG.HINT_DELAY) {
      return
    }
    // Repeats while nothing happens, so a hint missed is a hint given again.
    this.sinceMove = CONFIG.HINT_DELAY - CONFIG.HINT_REPEAT
    const chain = this.board.longestChain()
    if (chain.length >= this.mode.minChain) {
      this.#showHint(chain)
    }
  }

  // Point at these dots. Both halves are set whatever the settings say, and the view
  // shows the one it is allowed to.
  #showHint(dots) {
    this.hint = { dots: dots.slice(), age: 0 }
    if (!this.reducedMotion) {
      for (const dot of dots) {
        dot.nudge(CONFIG.HINT_WOBBLE, 0)
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
        // A mode that recoloured something has changed the board under the player, which
        // is worth pointing at, not decorating.
        this.#showHint(changed)
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
    if (verdict === "stranded" && this.overFor === 0) {
      // Which dot ended it. A board still full of matches does not otherwise show what
      // went wrong, and the whole lesson of the level is in that one dot.
      const stranded = this.board.strandedDot()
      if (stranded) {
        this.#showHint([stranded])
      }
    }
    // A dead board sits there for a moment first: long enough to see that nothing
    // matches, short enough not to feel stuck.
    this.overFor += dt
    if (this.overFor < (verdict === "won" ? 0.4 : CONFIG.LOSE_DELAY)) {
      return
    }
    // A cleared level is held up before whatever follows it, the last one included: see
    // #levelCleared, which is also where its record is kept.
    if (verdict === "won" && this.currentLevel) {
      this.#levelCleared()
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
    // The link into this dot starts at nothing and reaches out to it.
    dot.grow = 0
    player.chain.push(dot)
  }

  #release(dot) {
    dot.claim = null
    dot.linked = false
    dot.grow = 0
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
    this.sinceMove = 0
    Sound.link(0)
    return true
  }

  // Take the chain to a cell, which is what both a cursor move and a pointer drag
  // amount to. Extends, retracts or does nothing, by the board's rules.
  //
  // Refused while a menu is open, as every other way of spending or gathering a chain is.
  // This is the one choke point all of them go through, so it is where the board is closed
  // off rather than in each caller.
  extendTo(playerIndex, col, row) {
    const player = this.players[playerIndex]
    if (!player || this.page || player.chain.length === 0) {
      return false
    }
    const dot = this.board.at(col, row)
    const action = this.board.linkAction(player.chain, dot, player.index)
    if (action === "extend") {
      this.#claim(player, dot)
      this.sinceMove = 0
      Sound.link(player.chain.length - 1)
      return true
    }
    if (action === "retract") {
      this.#release(player.chain.pop())
      // The note of the dot the chain has gone back to, so taking one off is heard as
      // plainly as putting one on: a chain built to three and unpicked sounds 1 2 3 2 1.
      Sound.link(player.chain.length - 1)
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
    this.turns++

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
    this.sinceMove = 0
    this.hint = null
    if (length >= CONFIG.MULTIPLIER_CHAIN) {
      player.multiplier = Math.min(player.multiplier + 1, CONFIG.MULTIPLIER_MAX)
      Sound.multiplier(player.multiplier)
    } else {
      player.multiplier = 1
    }
    return scored
  }

  // Let a chain go without spending it. `quiet` skips the sound, for a chain
  // dropped because the game ended, not because the player let go.
  #dropChain(player, quiet = false) {
    if (player.chain.length === 0) {
      return
    }
    for (const dot of player.chain) {
      this.#release(dot)
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
    // Holding: the press has already done its work and the release will spend it. A
    // second press means the first release went missing, so there is nothing to do but
    // wait for one.
    if (this.holdToLink) {
      return
    }
    if (player.chain.length >= this.mode.minChain) {
      this.popChain(playerIndex)
    } else {
      this.#dropChain(player)
    }
  }

  // The button coming back up, which is what spends a chain while holding. Ignored
  // entirely in the toggle setting, where a chain outlives the press that started it.
  linkRelease(playerIndex = 0) {
    if (this.page || !this.holdToLink) {
      return
    }
    const player = this.players[playerIndex]
    if (!player || player.chain.length === 0) {
      return
    }
    if (player.chain.length >= this.mode.minChain) {
      this.popChain(playerIndex)
    } else {
      // Nothing was really invested in one or two dots, so letting go of them is not
      // worth a noise.
      this.#dropChain(player, player.chain.length < 2)
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
      // The edge of the board: there is nowhere that way.
      this.#soundBlocked()
      return
    }
    // A chain follows the cursor, so a move the chain cannot make is refused and the
    // cursor stays where it is. Even for a chain of one: while the button is held, letting
    // go of what is held because a thumb went the wrong way is not something anyone asked
    // for. The drop button is what lets go.
    if (player.chain.length > 0 && !this.extendTo(playerIndex, col, row)) {
      this.#soundBlocked()
      return
    }
    player.cursor.col = col
    player.cursor.row = row
    this.#soundCursor(player)
  }

  // A move that could not happen. Rate-limited, because a direction held against the edge
  // of the board repeats at the cursor's own rate and thirteen of these a second is a
  // machine gun instead of a refusal.
  #soundBlocked() {
    if (this.time - this.blockedAt < BLOCKED_GAP) {
      return
    }
    this.blockedAt = this.time
    Sound.blocked()
  }

  // What the cursor has arrived on, as a sound: how long a chain could be from here, or
  // that there is nothing here worth taking. Only with nothing in hand - while a chain is
  // being gathered the link and retract tones are already saying where it is.
  #soundCursor(player) {
    if (player.chain.length > 0 || !this.board) {
      return
    }
    const dot = this.board.at(player.cursor.col, player.cursor.row)
    Sound.cursor(this.board.reachFrom(dot), this.mode.minChain)
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
      // Hovering still moves the cursor, so the mouse and the keyboard agree about where
      // the player is looking - which is what shows a special's blurb, and what the cursor
      // sound is about. Only on a change of cell, or a sweep of the mouse is a racket.
      if (!this.page && (player.cursor.col !== cell.col || player.cursor.row !== cell.row)) {
        player.cursor.col = cell.col
        player.cursor.row = cell.row
        this.#soundCursor(player)
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
    // A key that goes down and comes up while the window is elsewhere would otherwise be
    // stuck down. While holding, the chain is the button being down, so it goes with the
    // window; in the toggle setting a chain outlives its press by design and losing one
    // to an alt-tab would be a nasty surprise.
    for (const player of this.players) {
      player.dragging = false
      if (this.holdToLink) {
        this.#dropChain(player, true)
      }
    }
  }

  // ---- menus --------------------------------------------------------------
  // A page is a list of rows the view draws and the input layer walks. A row is data:
  // what kind of thing it is, and what it holds. What each one does lives in #activate
  // and #chooseOption, keyed by an id.
  //
  // The kinds:
  //   heading   a section title. Not selectable; the cursor steps over it.
  //   buttons   a block of big pressable cells, laid out in `columns`. This is what
  //             anything worth pressing is: one cell wide for the thing a page is for,
  //             two for a pair, and a grid for the modes. A null cell holds
  //             its place without drawing, which is how a button keeps the same corner
  //             of the panel on a page that has nothing to put beside it.
  //   options   a strip of settings values, any of which can be pressed directly.
  //             Unlike buttons, walking onto one applies it: it is a value, not an act.
  //   binding   a control waiting to be told which key or button works it.
  //   hint      one line about whatever the cursor is on. A row of its own, so a page can
  //             put it where it belongs: under the mode grid it explains and above the
  //             button that leaves the page.
  //
  // Two cursors: `menuIndex` is the row, `menuOption` the cell within it.
  //
  // Two corners of the panel are fixed, so the button a player reaches for without
  // looking is always in the same place: Back at the bottom left, since back is a
  // leftward thing everywhere else, and Controls at the bottom right.
  menuRows() {
    switch (this.page) {
      case "title":
        return [
          this.#buttons([{ action: "modes", label: "New game" }], { primary: true }),
          this.#buttons([null, { action: "settings", label: "Settings" }]),
        ]
      case "pause":
        return [
          this.#buttons([
            { action: "resume", label: "Resume" },
            { action: "restart", label: "Restart" },
          ]),
          // The full width of the panel, as on the title screen, since it leads to the
          // same place. Not filled like the one there, though: on the title it is the
          // thing to press, and here it is the thing to press instead of resuming.
          this.#buttons([{ action: "modes", label: "New game" }]),
          ...(this.levels && this.levels.length > 1
            ? [this.#buttons([{ action: "levels", label: "Puzzles" }])]
            : []),
          this.#buttons([
            { action: "title", label: "Quit to title" },
            { action: "settings", label: "Settings" },
          ]),
        ]
      case "cleared": {
        const cleared = this.cleared
        // A star earned leaves nothing to decide, so the only thing to press is the one that
        // carries on. Short of par there is a choice, and the level is offered again beside
        // it - with the cursor on carrying on, since that is the answer that costs nothing.
        const onward = {
          action: "continue",
          label: cleared && cleared.last ? "Finish" : "Continue",
        }
        const starred = Boolean(cleared && cleared.starred)
        return [
          this.#buttons(starred ? [onward] : [{ action: "retry", label: "Retry level" }, onward], {
            primary: starred,
          }),
          this.#buttons([
            { action: "levels", label: "Puzzles" },
            { action: "title", label: "Quit to title" },
          ]),
        ]
      }
      case "settings":
        return [
          ...this.#settingRows(),
          { id: "hint", kind: "hint" },
          this.#buttons([
            { action: "back", label: "Back" },
            { action: "controls", label: "Controls" },
          ]),
        ]
      case "over": {
        const rows = []
        // A level lost is a puzzle got wrong, so another go at that level is the thing
        // this page is for; starting from the first level again is offered beside it.
        if (this.currentLevel && this.outcome !== "won") {
          rows.push(
            this.#buttons([{ action: "retry", label: "Retry level" }], {
              primary: true,
              hint: `Level ${this.level + 1}: ${this.currentLevel.name}`,
            }),
          )
        } else {
          rows.push(this.#buttons([{ action: "again", label: "Play again" }], { primary: true }))
        }
        rows.push({ id: "hint", kind: "hint" })
        rows.push(
          this.#buttons([
            // Play again is another go at the same board, so the way to a different one
            // belongs here, in the slot the puzzle ladder uses on its own pages.
            this.currentLevel
              ? { action: "levels", label: "Puzzles" }
              : this.mode.seeded
                ? { action: "seed", label: "Another code" }
                : null,
            { action: "modes", label: "Choose a mode" },
          ]),
        )
        return rows
      }
      case "modes":
        return [
          {
            id: "modes",
            kind: "buttons",
            columns: 2,
            options: GAME_MODES.map((mode) => ({
              action: `mode:${mode.id}`,
              label: mode.name,
              // The cell's own, not the running game's: mid-game the grid does not preview
              // what it is pointing at, so the mode being pointed at has to say what it is
              // itself.
              hint: mode.blurb,
              // Marks the one last played, so a returning player can see where they
              // left off without it being pressed for them.
              marked: mode.id === this.settings.mode,
            })),
          },
          { id: "hint", kind: "hint" },
          this.#buttons([{ action: "back", label: "Back" }, null]),
        ]
      case "levels":
        return [
          {
            id: "levels",
            kind: "buttons",
            // Drawn as a grid of boards; see #drawLevels. Everything else about it - walking
            // it, pressing it, what it sounds like - is a block of buttons.
            layout: "levels",
            columns: LEVEL_COLUMNS,
            options: (this.levels || []).map((level, index) => {
              const unlocked = this.levelUnlocked(index)
              const best = this.levelBest()[index]
              return {
                action: `level:${index}`,
                label: String(index + 1),
                // Locked cells are drawn - a ladder with gaps in it is not a ladder - but
                // nothing may land on one.
                locked: !unlocked,
                cleared: this.levelCleared(index),
                starred: this.levelStarred(index),
                // Whether there is a star to be had here at all: see levelContested.
                contested: this.levelContested(index),
                best,
                level,
                hint: unlocked
                  ? `${level.name}${best === undefined ? "" : `, best ${best} of ${level.par}`}`
                  : "Clear the one before it first",
              }
            }),
          },
          { id: "hint", kind: "hint" },
          // The other set, where the picker had an empty slot. A player stuck on one ladder can
          // go and play the other rather than being stuck on the game.
          this.#buttons([
            { action: "back", label: "Back" },
            this.otherLevelSet
              ? {
                  action: "levelSet",
                  label: this.otherLevelSet.name,
                  hint: `Swap to the ${this.otherLevelSet.name} puzzles, ${this.otherLevelSet.levels.length} of them`,
                }
              : null,
          ]),
        ]
      case "seed":
        return [
          {
            id: "seed",
            kind: "buttons",
            // Drawn as the six dots it is; see #drawSeed. Everything else about it is a block
            // of buttons, which is what gives it the whole interaction for nothing: left and
            // right step along the code, up and down leave it, and a press acts on the dot
            // under the cursor.
            layout: "seed",
            columns: SEED_DOTS,
            options: coloursFromSeed(this.seedDraft).map((colour, index) => ({
              action: `seedDot:${index}`,
              label: String(colour + 1),
              colour,
              hint: "Press to change this dot, or type a digit",
            })),
          },
          { id: "hint", kind: "hint" },
          this.#buttons([{ action: "seedPlay", label: "Play" }], { primary: true }),
          this.#buttons([
            { action: "seedToday", label: "Today" },
            { action: "seedRandom", label: "Surprise me" },
          ]),
          this.#buttons([{ action: "back", label: "Back" }, null]),
        ]
      case "controls":
        return [
          ...this.#controlRows(),
          { id: "hint", kind: "hint" },
          this.#buttons([
            { action: "back", label: "Back" },
            { action: "resetBindings", label: "Reset to defaults" },
          ]),
        ]
      default:
        return []
    }
  }

  // A block of buttons, one row across unless told otherwise. `primary` fills every
  // cell, not only the one under the cursor, for the single thing a page is for.
  #buttons(options, { primary = false, hint = null, columns = 0 } = {}) {
    return {
      id: `buttons:${options.map((option) => (option ? option.action : "-")).join(",")}`,
      kind: "buttons",
      columns: columns || options.length,
      primary,
      hint,
      // The row that leads out of a page is the page's furniture and not its contents, which
      // is how the view knows to draw it smaller and set apart. Derived here rather than
      // passed, so a page that grows a way out cannot forget to say so.
      furniture: options.some((option) => option && option.action === "back"),
      options,
    }
  }

  // The settings, each a row of values with its name in the gutter beside them.
  // Beside, because there are eight of these and a heading each would not fit the field -
  // and a name at the left of the values it names reads as belonging to them anyway.
  #settingRows() {
    return [
      {
        id: "theme",
        kind: "options",
        label: "Theme",
        selected: Math.max(THEME_IDS.indexOf(this.settings.theme), 0),
        // The preview is the option: a little board in that theme says more than its
        // name does, and it is what makes the row worth pressing.
        options: THEME_IDS.map((id) => ({ id, label: THEMES[id].name, preview: id })),
      },
      {
        id: "brightness",
        kind: "options",
        label: "Light",
        selected: clamp(this.settings.brightness, 0, CONFIG.BRIGHTNESS_LEVELS.length - 1),
        options: CONFIG.BRIGHTNESS_LEVELS.map((level) => ({ id: level.name, label: level.name })),
      },
      {
        id: "sound",
        kind: "options",
        label: "Sound",
        selected: this.settings.sound ? 0 : 1,
        options: [
          { id: "on", label: "On" },
          { id: "off", label: "Off" },
        ],
      },
      {
        id: "link",
        kind: "options",
        label: "Chains",
        selected: this.holdToLink ? 0 : 1,
        options: [
          { id: "hold", label: "Hold", hint: "Hold to gather dots, let go to pop them" },
          { id: "toggle", label: "Toggle", hint: "Press to start a chain, press again to pop" },
        ],
      },
      {
        id: "shapes",
        kind: "options",
        label: "Shapes",
        selected: this.settings.shapes === "on" ? 0 : 1,
        options: [
          { id: "on", label: "On", hint: "Each colour carries a shape of its own" },
          { id: "off", label: "Off", hint: "Colour alone tells the dots apart" },
        ],
      },
      {
        id: "font",
        kind: "options",
        // "Letters" rather than "Font", because what the setting changes is what a letter
        // looks like and the row is read beside Shapes, which is the same job for the dots.
        label: "Letters",
        selected: Math.max(FONTS.indexOf(this.font), 0),
        // The cell holds the short name and the hint line holds the whole of it, which is
        // what lets a face be named properly without a name that will not fit a cell.
        options: FONTS.map((font) => ({ id: font.id, label: font.name, hint: font.hint })),
      },
      {
        id: "hints",
        kind: "options",
        label: "Hints",
        selected: this.hintsOn ? 0 : 1,
        options: [
          { id: "on", label: "On", hint: "A settled board points out a move eventually" },
          { id: "off", label: "Off", hint: "Never points anything out" },
        ],
      },
      {
        id: "speech",
        kind: "options",
        label: "Speech",
        selected: this.speechOn ? 0 : 1,
        options: [
          { id: "on", label: "On", hint: "The menus read themselves out" },
          { id: "off", label: "Off", hint: "The menus are silent" },
        ],
      },
      {
        id: "motion",
        kind: "options",
        label: "Motion",
        selected: this.reducedMotion ? 1 : 0,
        options: [
          { id: "full", label: "Full", hint: "Particles and glass menus" },
          {
            id: "reduced",
            label: "Reduced",
            hint: "No particles, a slower fall, solid menus",
          },
        ],
      },
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
      return `Button ${value}`
    }
    const keys = Array.isArray(value) ? value : [value]
    return keys.map(keyLabel).join(" / ")
  }

  // ---- walking a menu -----------------------------------------------------
  // A heading and a hint are things a page says, not things it offers, so the cursor
  // steps over both. Landing on one is how the cursor disappears: neither draws it.
  #selectable(row) {
    return row.kind !== "heading" && row.kind !== "hint"
  }

  // Whether the cursor may land on a cell. A null is a place-holder keeping a corner empty;
  // a locked level is drawn but cannot be played, and both are stepped over.
  #pressable(cell) {
    return Boolean(cell) && !cell.locked
  }

  // Where the cursor lands when it arrives on a row: the first cell there is to press,
  // except on the mode grid, where it is the mode already chosen.
  #firstOption(row) {
    if (!row || row.kind !== "buttons") {
      return 0
    }
    // The furthest level reached, so a picker opens where a player left off and not at the
    // bottom of a ladder they have already climbed.
    if (row.id === "levels") {
      const last = row.options.findLastIndex((cell) => this.#pressable(cell))
      return last < 0 ? 0 : last
    }
    if (row.id === "modes") {
      return Math.max(GAME_MODES.indexOf(this.mode), 0)
    }
    // Carrying on, where a row offers it: the cleared page puts the level again to the left
    // of it in reading order, and going back to a level already cleared is the deliberate
    // one of the two.
    const onward = row.options.findIndex((cell) => cell && cell.action === "continue")
    if (onward >= 0) {
      return onward
    }
    const first = row.options.findIndex((cell) => this.#pressable(cell))
    return first < 0 ? 0 : first
  }

  #goToRow(index, rows = this.menuRows()) {
    this.menuIndex = index
    this.menuOption = this.#firstOption(rows[index])
  }

  menuMove(delta) {
    const rows = this.menuRows()
    if (rows.length === 0) {
      return
    }
    // A block of buttons is one row holding several, so up and down move a line inside it
    // and only leave it when there is no line left to move to. Where the line moved onto
    // is short of the column being left - the last line of the mode grid holds one - the
    // cursor takes the nearest cell along it and stays in the block.
    const here = rows[this.menuIndex]
    if (here && here.kind === "buttons") {
      const columns = here.columns || here.options.length
      const line = Math.floor(this.menuOption / columns) + delta
      const lines = Math.ceil(here.options.length / columns)
      if (line >= 0 && line < lines) {
        const start = line * columns
        const end = Math.min(start + columns, here.options.length) - 1
        let target = Math.min(start + (this.menuOption % columns), end)
        // And back along the line past anything only holding its place.
        while (target > start && !this.#pressable(here.options[target])) {
          target--
        }
        if (this.#pressable(here.options[target])) {
          this.menuOption = target
          this.#hover(here, target)
          this.#playCursor()
          return
        }
      }
    }
    let index = this.menuIndex
    for (let guard = 0; guard < rows.length; guard++) {
      index = (index + delta + rows.length) % rows.length
      if (this.#selectable(rows[index])) {
        break
      }
    }
    if (index !== this.menuIndex) {
      this.#goToRow(index, rows)
      this.#hover(rows[index], this.menuOption)
      this.#playCursor()
    }
  }

  menuAdjust(delta) {
    const row = this.menuRows()[this.menuIndex]
    if (!row) {
      return
    }
    if (row.kind === "buttons") {
      // Left and right step across the block, over any cell that is only holding its
      // place, and off the end of a line onto the next.
      let next = this.menuOption + delta
      while (next >= 0 && next < row.options.length && !this.#pressable(row.options[next])) {
        next += delta
      }
      if (next >= 0 && next < row.options.length) {
        this.menuOption = next
        this.#hover(row, next)
        this.#playCursor()
      } else {
        this.#soundBlocked()
      }
      return
    }
    if (row.kind !== "options") {
      return
    }
    // Walked, never wrapped: these are short lists where the ends are meaningful,
    // and a brightness that jumps from full to night on one press is a nasty surprise
    // in a dark room.
    const next = clamp(row.selected + delta, 0, row.options.length - 1)
    if (next !== row.selected) {
      this.#chooseOption(row, next)
    } else {
      // Already at one end of the row, which is worth hearing: it is how a player who is
      // not looking knows the setting is as far that way as it goes.
      this.#soundBlocked()
    }
  }

  menuConfirm() {
    const row = this.menuRows()[this.menuIndex]
    if (!row) {
      return
    }
    if (row.kind === "buttons") {
      const option = row.options[this.menuOption]
      if (option) {
        this.#activate(option.action)
      }
      return
    }
    if (row.kind === "binding") {
      const [, device, control] = row.id.split(":")
      this.rebinding = { device, control }
      Sound.menuConfirm()
      return
    }
    // An options row has nothing to confirm: a value is taken by pressing it or by
    // walking onto it, and either way it has already been applied.
  }

  // A press on a menu row from a pointer. `option` is which cell of the row was hit, so
  // a tap reaches a particular button or setting directly.
  menuTap(index, option = null) {
    const rows = this.menuRows()
    const row = rows[index]
    if (!row || !this.#selectable(row)) {
      return
    }
    this.menuIndex = index
    if (row.kind === "buttons") {
      const cell = option ?? this.menuOption
      if (row.options[cell]) {
        this.menuOption = cell
        this.#activate(row.options[cell].action)
      }
      return
    }
    if (row.kind === "options") {
      if (option != null && option !== row.selected) {
        this.#chooseOption(row, option)
      }
      return
    }
    this.menuConfirm()
  }

  // The cursor following a pointer across the menu, without pressing anything. This is
  // what lets a mode be hovered to read what it is.
  menuHover(index, option = null) {
    const rows = this.menuRows()
    const row = rows[index]
    if (!row || !this.#selectable(row)) {
      return
    }
    const cell = row.kind === "buttons" ? (option ?? this.menuOption) : this.menuOption
    if (row.kind === "buttons" && !row.options[cell]) {
      return
    }
    if (this.menuIndex === index && this.menuOption === cell) {
      return
    }
    this.menuIndex = index
    this.menuOption = cell
    this.#hover(row, cell)
  }

  // The note the thing under the cursor sounds, in semitones from the tuning's root.
  //
  // Anything that recurs between pages has one of its own, so Back is Back wherever it is
  // put; everything else is numbered down the page and across each row, so the pitch rises
  // the way a reader's eye does. Either way it is the same note every time, which is what
  // makes a menu walkable without being looked at. See MENU_NOTES.
  menuNote() {
    const rows = this.menuRows()
    let index = 0
    for (const [row, entry] of rows.entries()) {
      if (!this.#selectable(entry)) {
        continue
      }
      if (row === this.menuIndex) {
        if (entry.kind === "buttons") {
          const cell = entry.options[this.menuOption]
          const known = cell ? MENU_NOTES[cell.action] : undefined
          if (known !== undefined) {
            return known
          }
          // Placeholder cells are not offered, so they are not counted.
          return this.#positionalNote(
            index + entry.options.slice(0, this.menuOption).filter(Boolean).length,
          )
        }
        // A row of settings is pointed at by the value it holds, having no cursor of its own.
        return this.#positionalNote(index + (entry.kind === "options" ? entry.selected : 0))
      }
      index += this.#itemCount(entry)
    }
    return this.#positionalNote(index)
  }

  // An item's place on its page, as semitones. See MENU_STEP for how far apart two
  // neighbouring items are and why.
  #positionalNote(place) {
    return place * MENU_STEP
  }

  #itemCount(row) {
    if (row.kind === "buttons") {
      return row.options.filter(Boolean).length
    }
    if (row.kind === "options") {
      return row.options.length
    }
    return 1
  }

  #playCursor() {
    Sound.menuMove(this.menuNote())
    Speech.say(this.menuSpeech())
  }

  // What the thing under the cursor is, in words: the same item the note describes, for
  // anyone who would rather be told than learn the tune.
  //
  // The name comes first and its state after it, so the word being listened for arrives
  // before anything qualifying it, and the line explaining it comes last: it is the
  // longest part and the least new, and the next move cuts it off harmlessly.
  menuSpeech() {
    const rows = this.menuRows()
    const row = rows[this.menuIndex]
    if (!row) {
      return ""
    }
    if (row.kind === "options") {
      const chosen = row.options[clamp(row.selected, 0, row.options.length - 1)]
      if (!chosen) {
        return row.label || ""
      }
      return [row.label, chosen.label, chosen.hint].filter(Boolean).join(", ")
    }
    if (row.kind === "buttons") {
      const cell = row.options[this.menuOption]
      if (!cell) {
        return ""
      }
      return [cell.label, cell.hint ?? row.hint].filter(Boolean).join(", ")
    }
    if (row.kind === "binding") {
      return [row.label, row.value].filter(Boolean).join(", ")
    }
    return row.label || ""
  }

  // What page this is, said the way the page reads: its heading, and on the game-over
  // page the score with it, since that is what the page is for.
  pageSpeech() {
    if (this.page === "over") {
      const best = this.best[this.mode.id] || 0
      const record = this.player.score >= best && this.player.score > 0
      return `${this.outcomeText}. ${this.player.score}${record ? ", best yet" : ""}`
    }
    if (this.page === "pause") {
      // The same words the page shows, which is the point of pausing for anyone who cannot
      // read the score off the board: what is being played, what it has paid so far, and
      // what it has cost.
      return [this.mode.name, this.boardName, this.scoreLine, this.turnsLine]
        .filter(Boolean)
        .join(". ")
    }
    if (this.page === "cleared" && this.cleared) {
      // The star first: it is the mark, and the numbers behind it are how it was arrived at.
      const cleared = this.cleared
      const star = cleared.starred ? ", star" : ""
      const par = cleared.par > 0 ? ` of ${cleared.par}` : ""
      return `${PAGE_TITLES.cleared}${star}. ${cleared.scored}${par}, ${turnsText(cleared.turns)}`
    }
    // Why this page is the page being looked at, said before what is on it: a player who did
    // not ask for it needs to hear that first.
    if (this.notice) {
      return `${PAGE_TITLES[this.page] || ""}. ${this.notice}`
    }
    if (this.page === "seed") {
      // Spelled out, so a code can be written down from hearing it, and what it has already
      // given up, which is what makes a board worth another go.
      const code = seedCode(this.seedDraft).split("").join(" ")
      const best = this.seedBestFor(this.seedDraft)
      return `${PAGE_TITLES.seed}. Code ${code}${best ? `, best ${best}` : ""}`
    }
    return PAGE_TITLES[this.page] || ""
  }

  // Say what changed, from one place: a page can be opened, closed, replaced or finished
  // from half a dozen places, and what matters to a listener is only that it is different
  // now. Called every frame, which costs two comparisons while speech is off.
  #announce() {
    if (this.page !== this.spokenPage) {
      this.spokenPage = this.page
      if (this.page) {
        Speech.say(`${this.pageSpeech()}. ${this.menuSpeech()}`)
      } else {
        // Back to the board: nothing more to read, and a half-read menu is not worth
        // hearing over the game.
        Speech.silence()
      }
    }
    // A banner is the board saying something on its own account, which is the one event
    // that has no cursor behind it.
    const banner = this.banner ? `${this.banner.text}. ${this.banner.sub ?? ""}` : null
    if (banner !== this.spokenBanner) {
      this.spokenBanner = banner
      if (banner) {
        Speech.say(banner)
      }
    }
  }

  // Moving onto a cell, which for most of them is nothing at all. The mode grid is the
  // exception: it shows what it is pointing at.
  #hover(row, option) {
    if (row && row.id === "modes" && row.options[option]) {
      this.#previewMode(GAME_MODES[clamp(option, 0, GAME_MODES.length - 1)])
    }
  }

  menuBack() {
    if (this.rebinding) {
      this.cancelRebind()
      return
    }
    if (NESTED_PAGES.has(this.page)) {
      this.#closePage()
      return
    }
    if (this.page === "pause") {
      this.page = null
      Sound.menuBack()
      return
    }
    // There is nothing behind a cleared level to go back to, so back carries on: a page
    // with no way out of it is the one thing a menu must never be.
    if (this.page === "cleared") {
      Sound.menuBack()
      this.#continueLevel()
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
      // A drag is a hold by nature, so a page arriving under one ends it: the pointer that
      // was gathering dots is over a panel now. A chain held in the toggle setting stays,
      // for the reason onBlur gives.
      for (const player of this.players) {
        if (player.dragging) {
          this.#dropChain(player, true)
        }
      }
      this.#resetMenuCursor()
      Sound.menuConfirm()
    }
  }

  #openPage(page) {
    this.pageReturn = this.page
    this.page = page
    this.#resetMenuCursor()
  }

  #closePage() {
    this.page = this.pageReturn ?? (this.phase === PHASE.PLAYING ? "pause" : "title")
    this.pageReturn = null
    this.rebinding = null
    // A notice explains why a page was opened, so it goes when the page is left.
    this.notice = null
    this.#resetMenuCursor()
    Sound.menuBack()
  }

  // Where a page's cursor starts: the first row there is to press, and the first cell of
  // it. Every route into a page goes through this, so none of them can leave the cursor
  // pointing at a row that page does not have or a cell that row does not.
  #resetMenuCursor() {
    const rows = this.menuRows()
    this.#goToRow(this.#firstRow(rows), rows)
  }

  // Which row a page opens on. The first there is to press, except where that is not the one
  // to press: the seed picker's code sits at the top because that is where a code belongs,
  // and a player who takes the code offered wants Play.
  #firstRow(rows) {
    if (this.page === "seed") {
      const play = rows.findIndex((row) =>
        (row.options || []).some((cell) => cell && cell.action === "seedPlay"),
      )
      if (play >= 0) {
        return play
      }
    }
    return Math.max(
      rows.findIndex((row) => this.#selectable(row)),
      0,
    )
  }

  // What a button does, by the action it names.
  #activate(action) {
    if (action.startsWith("mode:")) {
      Sound.menuConfirm()
      const mode = modeById(action.slice(5))
      // A mode of authored levels is a list of boards, not one game: which one to play is
      // the next thing to ask, so it opens its picker instead of starting.
      if (mode.levels && this.levelsFor(mode.id).length > 1) {
        this.mode = mode
        this.settings.mode = mode.id
        this.#storeSettings()
        this.#openPage("levels")
        return
      }
      // A mode dealt from a code asks which code first, the same way. Through #previewMode,
      // which is a no-op mid-game: taking `mode` from under a live board would change the
      // rules it is being played by, and the code is taken up when it is played.
      if (mode.seeded) {
        this.#previewMode(mode)
        this.#openPage("seed")
        return
      }
      this.start(mode.id)
      return
    }
    if (action.startsWith("seedDot:")) {
      const index = Number(action.slice(8))
      // Round the colours: the ends of a code mean nothing, so a dot sitting on the last
      // colour has no reason to stop there.
      const colour = (coloursFromSeed(this.seedDraft)[index] + 1) % SEED_COLOURS
      this.#stepSeedDot(index, colour)
      // Pitched by the colour it landed on, so a press says what the dot became while
      // walking the strip says where along it you are.
      Sound.menuMove(colour * MENU_STEP)
      Speech.say(String(colour + 1))
      return
    }
    if (action.startsWith("level:")) {
      Sound.menuConfirm()
      this.start(this.mode.id, { level: Number(action.slice(6)) })
      return
    }
    switch (action) {
      case "modes":
        Sound.menuConfirm()
        this.#openPage("modes")
        break
      case "levels":
        Sound.menuConfirm()
        this.#openPage("levels")
        break
      case "levelSet": {
        const sets = this.levelSetsFor()
        if (!sets || sets.length < 2) {
          break
        }
        Sound.menuConfirm()
        this.settings.levelSet =
          (clamp(this.settings.levelSet, 0, sets.length - 1) + 1) % sets.length
        this.#storeSettings()
        // Open the new set where that set was left, not where the old one was, and say which set
        // this is: the grid redraws to different boards and nothing else would tell a player why.
        this.#openPage("levels")
        this.menuOption = this.furthestLevel()
        Speech.say(`${this.levelSet.name}, ${this.levels.length} puzzles`)
        break
      }
      case "seed":
        Sound.menuConfirm()
        this.#openPage("seed")
        break
      case "seedPlay":
        Sound.menuConfirm()
        this.start(SEEDED_MODE.id, { seed: this.seedDraft })
        break
      case "seedToday":
      case "seedRandom": {
        Sound.menuConfirm()
        this.#showSeed(action === "seedToday" ? dailySeed() : randomSeed())
        // Said outright: a code arrived at without walking to it is never announced, since
        // #announce only speaks a change of page.
        Speech.say(seedCode(this.seedDraft).split("").join(" "))
        break
      }
      case "again":
        Sound.menuConfirm()
        this.start(this.mode.id)
        break
      case "continue":
        Sound.menuConfirm()
        this.#continueLevel()
        break
      case "retry":
        Sound.menuConfirm()
        this.retryLevel()
        break
      case "restart":
        Sound.menuConfirm()
        // The board being played again, which on a ladder is the level being played and not
        // the ladder: starting the mode would deal its first level, throwing away a climb
        // nobody asked to leave.
        if (this.currentLevel) {
          this.retryLevel()
        } else {
          this.start(this.mode.id)
        }
        break
      case "resume":
        this.page = null
        Sound.menuBack()
        break
      case "title":
        Sound.menuBack()
        this.toTitle()
        break
      case "settings":
        Sound.menuConfirm()
        this.#openPage("settings")
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

  // Take one option of an options row, whether it was walked onto or pressed. Applied
  // at once: a setting a player is looking at is a setting they can see the effect of.
  #chooseOption(row, option) {
    switch (row.id) {
      case "theme":
        this.settings.theme = THEME_IDS[option] || THEME_IDS[0]
        this.#storeSettings()
        this.#playCursor()
        break
      case "brightness":
        this.settings.brightness = clamp(option, 0, CONFIG.BRIGHTNESS_LEVELS.length - 1)
        this.#storeSettings()
        this.#playCursor()
        break
      case "sound":
        this.setSound(option === 0)
        break
      case "link":
        this.settings.link = option === 1 ? "toggle" : "hold"
        // Whatever is being held was picked up under the old rule, and the new one has
        // no way to let go of it.
        for (const player of this.players) {
          this.#dropChain(player, true)
        }
        this.#storeSettings()
        this.#playCursor()
        break
      case "shapes":
        this.settings.shapes = option === 1 ? "off" : "on"
        this.#storeSettings()
        this.#playCursor()
        break
      case "font": {
        const wanted = FONTS[clamp(option, 0, FONTS.length - 1)]
        this.settings.font = wanted.id
        this.#storeSettings()
        this.#playCursor()
        // Fetched on being chosen, and taken up whenever it lands: the `font` getter holds
        // the standard face until then, so the wait is a menu that has not changed yet
        // rather than a menu with nothing in it.
        ensureFont(wanted.id)
        break
      }
      case "hints":
        this.settings.hints = option === 1 ? "off" : "on"
        this.hint = null
        this.sinceMove = 0
        this.#storeSettings()
        this.#playCursor()
        break
      case "speech":
        this.setSpeech(option === 0)
        break
      case "motion":
        this.settings.motion = option === 1 ? "reduced" : "full"
        if (this.reducedMotion) {
          this.particles.clear()
        }
        this.#storeSettings()
        this.#playCursor()
        break
      default:
        break
    }
  }

  // Look at a mode without committing to it: the board behind the menu becomes that
  // mode's, and the menu blips move to its tuning, so walking the grid is also seeing
  // and hearing what each one is. Nothing is stored until a game actually starts.
  #previewMode(mode) {
    // Nothing at all while a game is in progress. Mid-game the mode grid is a way to start
    // a different game rather than a way to look at one: taking `mode` from under a live
    // board would change the rules it is being played by, and rescaling the layout would
    // draw the board it already has at the wrong size - too small, or over its own edges.
    if (this.phase === PHASE.PLAYING) {
      return
    }
    this.mode = mode
    this.layout = boardLayout(mode.cols, mode.rows)
    this.tuning = resolveTuning(mode.tuning)
    Sound.setTuning(this.tuning)
    this.dealAttractBoard()
  }

  setSound(on) {
    this.settings.sound = on
    Sound.enabled = on
    this.#storeSettings()
    if (on) {
      // Turning sound on is always the result of a press, and a press is the user
      // gesture a browser needs before it will open an audio device at all.
      Sound.ensureContext()
      Sound.menuConfirm()
    }
  }

  // Turn the spoken menus on or off. Called from the settings row and from the page's own
  // toggle, which is the one a player who cannot see the settings row will find first.
  setSpeech(on) {
    const enabled = Speech.setEnabled(on)
    this.settings.speech = enabled ? "on" : "off"
    this.#storeSettings()
    Sound.menuConfirm()
    if (enabled) {
      // Said at once and not after the usual wait: this is the press that asked for
      // speech, so it is the one announcement that has to arrive immediately, and it
      // doubles as proof the voice works.
      Speech.sayNow(`Speech on. ${this.menuSpeech()}`)
    }
    return enabled
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
        // Stripped of its last key the control is unbound, which is a control with no entry:
        // an empty list is a value, and bindingLabel would draw it as an empty value.
        if (filtered.length > 0) {
          table[control] = filtered
        } else {
          delete table[control]
        }
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

// A key code as a player would recognise it: the code without its category, so "KeyW"
// reads as W and "ArrowLeft" as Left. What is left is split at its capitals, which
// turns a code like "ShiftLeft" into spaced words.
export function keyLabel(code) {
  if (code.startsWith("Key")) {
    return code.slice(3)
  }
  if (code.startsWith("Digit")) {
    return code.slice(5)
  }
  if (code.startsWith("Arrow")) {
    return code.slice(5)
  }
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`
  }
  return code.replace(
    /([a-z])([A-Z])/g,
    (_match, before, after) => `${before} ${after.toLowerCase()}`,
  )
}
