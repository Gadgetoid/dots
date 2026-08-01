// Configuration, balance and input mapping. Everything tuneable lives here.
//
// The virtual space is a fixed 600x800 portrait field: the renderer letterboxes
// it into whatever the canvas actually is, so every coordinate in the game is in
// these units and nothing has to know the window size. A phone held upright and a
// desktop window therefore get the same layout.

export const VIEW_W = 600
export const VIEW_H = 800

// Where the board sits in the view. The score bar is above it and the mode line
// below, and the grid is fitted to what is left, so a 4x4 board and a 9x9 board
// both fill the same region with cells of a different size.
const BOARD_TOP = 112
const BOARD_BOTTOM = VIEW_H - 120
const BOARD_MARGIN = 28

// A dot against its cell. The gap is what the chain line runs through and what
// makes a grid read as dots rather than as tiles.
const DOT_RADIUS_RATIO = 0.34

export const CONFIG = {
  // ---- falling ----------------------------------------------------------
  // Dots are placed in the grid the moment a chain pops and then fall into
  // place, so the logical board is never mid-animation. Gravity is in cell
  // heights per second squared, so the feel holds at any grid size.
  GRAVITY: 46,
  // How much of its speed a dot keeps when it lands. A dot that hits hard bounces
  // once and settles, which is most of what sells the weight of the board.
  BOUNCE: 0.26,
  // Below this landing speed a dot simply stops instead of bouncing again.
  BOUNCE_FLOOR: 3.5,
  // Where a refilled dot starts, in cells above the top of the board. Spread
  // across the column so a refill arrives as a stream rather than a block.
  SPAWN_HEIGHT: 1.4,
  SPAWN_STAGGER: 0.85,

  // ---- the wobble -------------------------------------------------------
  // One damped oscillator per dot, stiff and lightly damped, so a nudge rings for about
  // half a second.
  //
  // A hint is the only thing that drives it, and nothing the board does on its own account
  // does. That is what makes it worth having: movement means "look here", and a board that
  // squashed a dot on every landing would be spending it on things that have already
  // happened and do not matter.
  WOBBLE_STIFFNESS: 460,
  WOBBLE_DAMPING: 9,
  // Ceiling on the deformation, as a fraction of the radius. Past about a third the shape
  // stops reading as a dot.
  WOBBLE_MAX: 0.34,
  // A linked dot swells, which is how the chain reads as picking dots up.
  LINK_SWELL: 0.16,
  LINK_SWELL_RATE: 9,

  // ---- hints ------------------------------------------------------------
  // How long a settled board waits before it points something out, and how often it
  // repeats while nothing is happening. Long enough not to answer a player who is still
  // thinking.
  HINT_DELAY: 8,
  HINT_REPEAT: 4,
  // What a hint puts into the wobble, and how long the ring lasts where there is no
  // wobble to be had. A hint has one job, which is to be noticed, so this is most of what
  // the deformation will take: a polite wobble is one nobody sees.
  HINT_WOBBLE: 6,
  HINT_RING_LIFE: 1.1,

  // ---- spoken menus -----------------------------------------------------
  // A shade over speaking pace. Fast enough that walking a page is not a wait, slow
  // enough to be understood the first time.
  SPEECH_RATE: 1.05,
  // How long after landing on an item it is spoken, in seconds. Two jobs at once: it
  // clears the item's own tone, which is 90ms long, so the two do not talk over each
  // other; and being longer than REPEAT_RATE it means a held direction plays tones the
  // whole way down a page and speaks only the item it comes to rest on.
  SPEECH_DELAY: 0.13,
  // And how long it waits when a line has only just been spoken.
  //
  // Cycling through options is presses a fifth of a second apart, which is slower than
  // SPEECH_DELAY: each line would start and be cut off a word in by the next, so the whole
  // flurry is heard as chopped-up syllables. Waiting longer once the voice is already going
  // means a flurry passes in silence and the item it ends on is read out whole, while a
  // single move after a pause is still answered promptly.
  SPEECH_SETTLE: 0.4,

  // ---- the chain --------------------------------------------------------
  // The chain is one distance field: a disc at each dot and a rod between them,
  // combined with a smooth minimum. These are what that field is made of, all as
  // fractions of the dot radius.
  //
  // The cord is exactly the dots' own radius, so a straight run is a rectangle
  // between two circles of the same width: the outline is straight, perpendicular to
  // the run, and never wider than a dot. The smoothing is not applied along a run at
  // all - it is the small fillet that softens the inside of a right-angle turn, and
  // nothing else.
  CHAIN_CORD_RATIO: 1,
  CHAIN_SMOOTH_RATIO: 0.5,
  // How fast a new link reaches out from the dot before it, per second. Fast enough
  // to keep up with a dragging finger, slow enough that the chain visibly grows
  // toward each dot rather than appearing joined to it.
  LINK_GROW_RATE: 13,
  // Glow builds as the chain grows: `base` at two dots, climbing by `perDot` and
  // holding at `max`. This is the bloom the player is playing toward, and the ceiling
  // is where it stops: the chain is a solid body the width of its dots, so it throws a
  // great deal of light for its length, and much past this the halo swallows the
  // colour it came from and every long chain looks the same white.
  CHAIN_GLOW: { base: 0.13, perDot: 0.075, max: 0.5 },
  // How fast the drawn glow chases the value above, per second, so a long chain
  // brightens smoothly and a pop does not snap dark.
  CHAIN_GLOW_RATE: 7,
  // Sparks that run along a live chain, per second per link.
  CHAIN_SPARK_RATE: 5,

  // ---- popping ----------------------------------------------------------
  // Particles per popped dot, and the ring it throws.
  POP_SPARKS: 20,
  POP_DUST: 8,
  POP_SPARK_SPEED: [110, 380],
  // The flash where the dot was: brief and bright, so a pop has an instant rather
  // than only an aftermath.
  POP_FLASH_LIFE: 0.16,
  POP_FLASH_SIZE: 2.2, // against the dot radius
  POP_DUST_SPEED: [10, 70],
  POP_RING_LIFE: 0.42,
  POP_RING_RADIUS: 1.75, // final radius, against the dot radius
  // A pop runs dot by dot from the start of the chain, so a long chain unzips.
  POP_STAGGER: 0.045,

  // ---- particles --------------------------------------------------------
  PARTICLE_GRAVITY: 620,
  PARTICLE_DRAG: 1.4,
  SPARK_LIFE: [0.34, 0.72],
  DUST_LIFE: [0.5, 1.1],
  // How far a spark's streak reaches behind it, in seconds of its own travel.
  SPARK_STREAK: 0.05,
  MAX_PARTICLES: 1400,

  // ---- scoring ----------------------------------------------------------
  // A chain is worth the fourth power of its length, so a long chain is worth far
  // more than the same dots taken a pair at a time: a six is twenty-seven pairs
  // rather than the nine the 32blit game's cube made it. Clearing four or more banks
  // a multiplier for the next chain.
  //
  // Every level's par and floor come off this, so changing it invalidates all of them
  // and the cache they are proved in; see tools/verify-levels.mjs.
  MULTIPLIER_CHAIN: 4,
  MULTIPLIER_MAX: 9,
  chainScore: (length) => length * length * length * length,

  // ---- pacing -----------------------------------------------------------
  // How long the board sits there once it has no move left, before the game says
  // so. Long enough to see that nothing matches, short enough not to feel stuck.
  LOSE_DELAY: 1.1,
  // Grace after a board settles before a loss is even tested, so a chain popped
  // on the same frame as the last match is never robbed.
  SETTLE_GRACE: 0.15,
  // Score popups over a popped chain.
  FLOATER_LIFE: 1.05,
  FLOATER_RISE: 84,

  // ---- audio ------------------------------------------------------------
  // Every voice is mixed through this, so an effect's own level only sets where
  // it sits against the others.
  MASTER_VOLUME: 4.5,
  // Amplitude above which the mix bends toward full scale instead of running past
  // it, so a long chain unzipping is squashed rather than clipped.
  AUDIO_SOFT_CLIP: 0.7,

  // ---- display ----------------------------------------------------------
  // Brightness settings, for playing at night. The composite pass multiplies the
  // whole frame by this, bloom included.
  BRIGHTNESS_LEVELS: [
    { name: "Night", value: 0.45 },
    { name: "Dim", value: 0.7 },
    { name: "Full", value: 1 },
  ],
  // Bloom shape. The glow layer is drawn and blurred separately from the scene,
  // so this is how much of it is added back rather than a brightness threshold.
  BLOOM_INTENSITY: 1,
  // How far a dot bends toward its shape when shapes are on, as a fraction of the radius
  // the edges are dented in by. Every shape dents by this much whatever its side count, so
  // a triangle and a hexagon are equally emphatic - see DOT_SHAPES in palette.js. Turn it
  // up for a board that shouts its shapes, down for one that only whispers them.
  SHAPE_STRENGTH: 0.16,
}

// Where a board of this shape sits, in view units. Everything the view draws for
// the board comes off this, so a mode changing its grid needs no layout code.
export function boardLayout(cols, rows) {
  const availableW = VIEW_W - BOARD_MARGIN * 2
  const availableH = BOARD_BOTTOM - BOARD_TOP
  const cell = Math.min(availableW / cols, availableH / rows)
  const width = cell * cols
  const height = cell * rows
  return {
    cols,
    rows,
    cell,
    radius: cell * DOT_RADIUS_RATIO,
    x: (VIEW_W - width) / 2,
    y: BOARD_TOP + (availableH - height) / 2,
    width,
    height,
  }
}

// The centre of a cell, taking a fractional row so a falling dot can be drawn
// between two of them.
export const cellCentre = (layout, col, row) => ({
  x: layout.x + (col + 0.5) * layout.cell,
  y: layout.y + (row + 0.5) * layout.cell,
})

// Which cell a point in view space is over, or null if it is off the board. The
// board is a grid of touch targets, so this is all pointer input needs.
export function cellAt(layout, x, y) {
  const col = Math.floor((x - layout.x) / layout.cell)
  const row = Math.floor((y - layout.y) / layout.cell)
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) {
    return null
  }
  return { col, row }
}

// How many levels the picker puts on a line. Four across a 600 wide field leaves a preview
// big enough to tell one board from another at a glance, which is the whole point of it;
// with the four lines the view shows at a time, sixteen are on screen at once.
export const LEVEL_COLUMNS = 4

// ---------------------------------------------------------------------------
// INPUT
//
// The 32blit version held A down and moved the D-pad, and let go to pop; a slip
// of the thumb threw the chain away. Here a press starts the chain and it stays:
// moving the cursor onto a neighbouring dot of the same colour extends it, moving
// back retracts it, a second press pops it and the cancel button drops it. The
// pop button is therefore the only thing that ever spends a chain, which is what
// makes it safe to take your time over a board.
//
// A pointer drags instead, which is what a pointer is for, and the two never
// disagree: both drive the same chain through the same rules.
// ---------------------------------------------------------------------------

export const GAMEPAD = {
  // The fixed controls: menu navigation and the buttons that reach the menu. A
  // rebind can never leave a player unable to open the menu and put it back.
  buttons: {
    pause: 8, // back / select
    confirm: 9, // start
    confirmAlt: 0,
    back: 1,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
  },
  axes: { x: 0, y: 1 },
  deadzone: 0.35, // stick travel ignored, so a resting stick does not drift
  triggerThreshold: 0.35, // how far a trigger travels before it counts as held
  // A pad binding is taken when the button comes back up, so B can be bound like
  // any other button. Holding it this long abandons the wait instead.
  rebindCancelHold: 0.6,
}

// How a held direction repeats, on any device: the first step is immediate, the
// next comes after DELAY and the rest at RATE. Slow enough to place a cursor
// exactly, fast enough to cross a 9x9 board.
export const REPEAT_DELAY = 0.26
export const REPEAT_RATE = 0.075

// The controls a player may rebind, in menu order, with each one's default per
// device. Cursor movement is bindable on a keyboard and fixed on a pad, where the
// D-pad and the left stick both already move it.
export const BINDABLE_CONTROLS = [
  { id: "up", name: "Up", defaults: { keys: ["ArrowUp", "KeyW"] } },
  { id: "down", name: "Down", defaults: { keys: ["ArrowDown", "KeyS"] } },
  { id: "left", name: "Left", defaults: { keys: ["ArrowLeft", "KeyA"] } },
  { id: "right", name: "Right", defaults: { keys: ["ArrowRight", "KeyD"] } },
  {
    id: "link",
    name: "Link and pop",
    defaults: { keys: ["Space"], buttons: GAMEPAD.buttons.confirmAlt },
  },
  { id: "cancel", name: "Drop chain", defaults: { keys: ["KeyX"], buttons: GAMEPAD.buttons.back } },
]

export const BINDING_DEVICES = [
  { id: "keys", name: "Keyboard", prompt: "Press a key" },
  { id: "buttons", name: "Gamepad", prompt: "Press a button" },
]

// Keys that cannot be bound to a game control: ENTER and ESCAPE work the menu, so
// they cannot also be the thing being captured.
export const RESERVED_KEYS = new Set(["Enter", "Escape"])

// And the pad buttons that reach the menu, for the same reason.
export const RESERVED_BUTTONS = new Set([GAMEPAD.buttons.pause, GAMEPAD.buttons.confirm])

// ---------------------------------------------------------------------------
// MENU NOTES - what the menus sound like, so they can be walked without being looked at.
//
// A menu item's note is a number of semitones from the tuning's root. Semitones rather
// than steps of the mode's own scale, because a five-note scale comes round again an
// octave up: on a page of seven things the sixth would sound the same as the first, and
// two items that sound the same are two items that cannot be told apart. Twelve semitones
// is twelve different notes, which covers any page here.
//
// Items are numbered down the page and across each row, so the pitch rises the way a
// reader's eye does. Anything that recurs from page to page has a note of its own below
// the root instead: Back is Back wherever it is put, and the furniture of a menu is
// audibly not its contents.
// ---------------------------------------------------------------------------
// How far apart two neighbouring items are, in semitones. A whole tone: two neighbouring
// semitones are the hardest interval there is to tell apart, and telling one item from the
// next is the entire job here.
export const MENU_STEP = 2

export const MENU_NOTES = {
  back: -12,
  title: -11,
  resume: -10,
  restart: -9,
  modes: -8, // new game, from the title screen or mid-game
  levels: -7.5, // the puzzle ladder, which sits beside new game and sounds next to it
  seed: -7.25, // the seed picker, which sits beside the puzzle ladder and sounds next to it
  seedPlay: -6.5,
  seedToday: -5.5,
  seedRandom: -5.25,
  again: -7,
  retry: -6,
  settings: -4,
  controls: -3,
  resetBindings: -2,
}

// A fresh bindings table, taken from the registry above.
export function freshBindings() {
  const bindings = {}
  for (const device of BINDING_DEVICES) {
    bindings[device.id] = {}
    for (const control of BINDABLE_CONTROLS) {
      const value = control.defaults[device.id]
      if (value !== undefined) {
        bindings[device.id][control.id] = Array.isArray(value) ? value.slice() : value
      }
    }
  }
  return bindings
}

// What the game remembers about how it should look, sound and play. Everything else
// about a session is derived from the mode.
export const DEFAULT_SETTINGS = {
  theme: "dark",
  brightness: 2, // index into CONFIG.BRIGHTNESS_LEVELS
  sound: true,
  mode: "classic",
  // The code last played in the seeded mode, so its picker opens on it again. Null until a
  // code has been played, and then the picker opens on today's board; see seed.js.
  seed: null,
  // Which set of authored levels the puzzle mode is on, as an index into its sets. Remembered,
  // so a player who swapped to the second ladder comes back to it.
  levelSet: 0,
  // How a button builds a chain. "hold" is the 32blit way and the default: hold it down,
  // move to gather dots, let go to pop. "toggle" splits that into two presses, for anyone
  // who would rather not hold a button down while aiming with the other hand - or at all.
  // A pointer drags either way; a drag is a hold by nature.
  link: "hold",
  // "reduced" turns off the particles, slows the fall, and makes the menus solid rather
  // than glass. Motion and transparency are the two things a person is most likely to need
  // less of, and neither carries any information the game needs. A hint still points, since
  // that does carry something; it rings rather than wobbles. See the hints setting for
  // whether it points at all.
  //
  // "auto" is the default and takes it from the browser, which is the one accessibility
  // preference here that can be asked for - unlike speech, see speech.js. It stays "auto"
  // until the row is pressed, and then it holds what was pressed: the setting is what the
  // player says, and until they have said anything the system is who to ask.
  motion: "auto",
  // Whether a settled board points out a move when nothing has happened for a while.
  hints: "on",
  // Whether each dot colour also carries a shape of its own, for anyone who cannot rely on
  // the colours. See DOT_SHAPES in palette.js for which shape goes where and why.
  shapes: "off",
  // Which face the game draws its text in, as an id from fonts.js. The standard one is the
  // system's own monospace and costs nothing; anything else is fetched when it is chosen.
  font: "standard",
  // Whether the menus read themselves out. Off unless asked for, because there is no way
  // to ask the browser: see speech.js.
  speech: "off",
}

// What each menu page is called. Shared, because the page's heading and the page's spoken
// announcement are the same words and only have to be written once.
export const PAGE_TITLES = {
  title: "Dots",
  modes: "New game",
  settings: "Settings",
  controls: "Controls",
  levels: "Puzzles",
  seed: "Seeded",
}

// What a finished board is told it did.
export const OUTCOMES = {
  lost: "No moves left",
  timeup: "Time up",
  won: "Board cleared",
  // A colour down to its last dot, which is a board that cannot be emptied however many
  // moves are still on it. Named apart from a dead board, since the two look nothing alike.
  stranded: "A colour is stranded",
  // Clearing the last authored level is not a board cleared, it is the whole mode
  // finished, which is the one thing in this game that can be won.
  levels: "All levels cleared",
}

// How much of the game's motion a reduced-motion session keeps. The fall is slowed
// rather than stopped: a dot that arrives without travelling cannot be followed.
export const REDUCED_MOTION_RATE = 0.62

// Whether the browser says this player has asked the system for less movement, which is
// what the "auto" motion setting follows.
//
// A MediaQueryList reads live, so asking it every frame follows a preference changed while
// the game is open without a listener - the same way the theme and the size are polled. It
// is made on the first ask and kept, since everything drawn asks per dot. Where there is no
// matchMedia to ask - under node, or a browser that will not answer - the honest answer is
// that nothing has been asked for.
let stillness = null

export function prefersReducedMotion() {
  if (!stillness && typeof matchMedia === "function") {
    stillness = matchMedia("(prefers-reduced-motion: reduce)")
  }
  return Boolean(stillness && stillness.matches)
}
