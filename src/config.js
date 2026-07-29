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
  // How much of a landing turns into a squash. The wobble is what a landing looks
  // like; the bounce alone reads as a rigid ball.
  LAND_SQUASH: 0.09,
  // Where a refilled dot starts, in cells above the top of the board. Spread
  // across the column so a refill arrives as a stream rather than a block.
  SPAWN_HEIGHT: 1.4,
  SPAWN_STAGGER: 0.85,

  // ---- jelly ------------------------------------------------------------
  // The wobble is one damped oscillator per dot, driven by impulses: joining a
  // chain, landing, or a neighbour popping. Stiff and lightly damped, so it rings
  // for about half a second.
  WOBBLE_STIFFNESS: 460,
  WOBBLE_DAMPING: 9,
  // Ceiling on the deformation, as a fraction of the radius. Past about a third
  // the shape stops reading as a dot.
  WOBBLE_MAX: 0.34,
  // What each event puts into the oscillator.
  WOBBLE_LINK: 3.4, // the dot just linked
  WOBBLE_CHAIN_WAVE: 1.5, // and the wave that runs back down the chain behind it
  WOBBLE_CHAIN_FALLOFF: 0.62, // how much of that reaches each dot further back
  WOBBLE_NEIGHBOUR: 2.1, // a dot next to one that just popped
  // A linked dot also swells, which is the other half of the response: the chain
  // reads as picking dots up rather than only shaking them.
  LINK_SWELL: 0.16,
  LINK_SWELL_RATE: 9,

  // ---- the chain --------------------------------------------------------
  // Subdivisions per link of the Catmull-Rom that rounds the chain's corners.
  CHAIN_SMOOTHING: 10,
  // Line thickness as a multiple of the dot radius. Two is the dot's full
  // diameter, so a chain and the dots on it merge into one continuous blob rather
  // than reading as beads on a cord - which is what the 32blit version drew, at
  // two dot radii and one pixel.
  CHAIN_WIDTH_RATIO: 2,
  // Glow builds as the chain grows: `base` at two dots, climbing by `perDot` and
  // holding at `max`. This is the bloom the player is playing toward, and the
  // ceiling is where it stops: past about one the halo is wide enough to swallow
  // the colour it came from and every long chain looks the same white.
  CHAIN_GLOW: { base: 0.22, perDot: 0.16, max: 1.05 },
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
  POP_RING_RADIUS: 2.6, // final radius, against the dot radius
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
  // A chain is worth the cube of its length, as the 32blit game scored it, so a
  // long chain is worth far more than the same dots taken a pair at a time.
  // Clearing four or more banks a multiplier for the next chain.
  MULTIPLIER_CHAIN: 4,
  MULTIPLIER_MAX: 9,
  chainScore: (length) => length * length * length,

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
    { name: "NIGHT", value: 0.45 },
    { name: "DIM", value: 0.7 },
    { name: "FULL", value: 1 },
  ],
  // Bloom shape. The glow layer is drawn and blurred separately from the scene,
  // so this is how much of it is added back rather than a brightness threshold.
  BLOOM_INTENSITY: 1,
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
  { id: "up", name: "UP", defaults: { keys: ["ArrowUp", "KeyW"] } },
  { id: "down", name: "DOWN", defaults: { keys: ["ArrowDown", "KeyS"] } },
  { id: "left", name: "LEFT", defaults: { keys: ["ArrowLeft", "KeyA"] } },
  { id: "right", name: "RIGHT", defaults: { keys: ["ArrowRight", "KeyD"] } },
  {
    id: "link",
    name: "LINK / POP",
    defaults: { keys: ["Space"], buttons: GAMEPAD.buttons.confirmAlt },
  },
  { id: "cancel", name: "DROP CHAIN", defaults: { keys: ["KeyX"], buttons: GAMEPAD.buttons.back } },
]

export const BINDING_DEVICES = [
  { id: "keys", name: "KEYBOARD", prompt: "PRESS A KEY" },
  { id: "buttons", name: "GAMEPAD", prompt: "PRESS A BUTTON" },
]

// Keys that cannot be bound to a game control: ENTER and ESCAPE work the menu, so
// they cannot also be the thing being captured.
export const RESERVED_KEYS = new Set(["Enter", "Escape"])

// And the pad buttons that reach the menu, for the same reason.
export const RESERVED_BUTTONS = new Set([GAMEPAD.buttons.pause, GAMEPAD.buttons.confirm])

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

// What the game remembers about how it should look and sound. Everything else
// about a session is derived from the mode.
export const DEFAULT_SETTINGS = {
  theme: "dark",
  brightness: 2, // index into CONFIG.BRIGHTNESS_LEVELS
  sound: true,
  mode: "classic",
}
