// The game's colour vocabulary, in two themes.
//
// Every colour the player sees is named here, so retheming is a single-file edit.
// Names describe what a colour is for, not what it looks like. Values are plain
// CSS colour strings, which the renderer parses and caches.
//
// The dot hues are the 32blit game's, which in turn are the original RaphaelJS
// game's: purple, blue, teal, red, orange. `base` is a dot at rest and `bright`
// is one in the chain, exactly the pairing the 32blit version drew with. The dark
// theme lifts both, since a saturated mid-tone that reads well on white goes muddy
// on near-black.

// How many dot colours a board deals from. The themes must each list this many.
export const DOT_COLOURS = 5

// A shape per dot colour, for anyone who cannot rely on the colours.
//
// Each dot is bent slightly toward a regular polygon - `sides` of them, turned by `turn`
// radians - so it carries a second, redundant signal. Slightly, because the board should
// still read as dots: how far is CONFIG.SHAPE_STRENGTH, and every shape dents its edges by
// the same fraction of the radius whatever its side count.
//
// Which shape goes on which colour is not arbitrary. Red-green deficiency is far and away
// the common case, and it confuses red with teal, red with orange, and purple with blue -
// so those three pairs get the shapes that look least alike, and the round one goes to a
// colour whose partners are already strongly marked:
//
//   purple  triangle, point up      blue    square
//   teal    square, turned 45       red     triangle, point down
//   orange  round
//
// Purple against blue is a triangle against a square; red against orange is a triangle
// against a circle; red against teal is three corners against four, turned. What is left
// weakest - a square against a diamond, for blue against teal - is a blue-yellow
// confusion, which is the rare one.
export const DOT_SHAPES = [
  { sides: 3, turn: -Math.PI / 2 }, // purple: point up
  { sides: 4, turn: 0 }, // blue: square
  { sides: 4, turn: Math.PI / 4 }, // teal: diamond
  { sides: 3, turn: Math.PI / 2 }, // red: point down
  { sides: 0, turn: 0 }, // orange: left round
]

const DARK = {
  id: "dark",
  name: "Dark",
  // The page around the canvas follows these, so the frame and the field agree.
  page: "#0a0c12",
  background: "#12141c",
  // The empty grid: where a dot would sit, and the well it falls down.
  well: "#181b25",
  cell: "#272c3c",
  panel: "#1a1e2b",
  panelEdge: "#2c3346",
  text: {
    bright: "#f2f5ff",
    normal: "#c3cbe2",
    dim: "#8b93ab",
    faint: "#5d6479",
  },
  cursor: "#8b93ab",
  cursorActive: "#f2f5ff",
  accent: "#5fd7ff",
  warn: "#ff6b6b",
  // What is laid over the board while a menu is up: enough to push it back, not enough
  // to hide it. The panel itself is frosted, so the board reads through both.
  scrim: { color: "#0a0c12", alpha: 0.45 },
  // How much of the panel's own colour is laid over the blurred board behind it. None
  // would be a window, all of it a wall.
  frost: 0.86,
  // How much light the whole theme throws into the bloom pass. Dark is where the
  // glow belongs, so it gets all of it.
  bloom: 1,
  // The bright variant is only a little brighter than the base. A dot in a chain
  // is already carrying the glow layer, and a pale bright on top of that puts the
  // whole chain to white: the hue has to survive its own bloom.
  dots: [
    { base: "#b455e6", bright: "#c86ff5" }, // purple
    { base: "#3cc4ff", bright: "#5fd2ff" }, // blue
    { base: "#2bbfae", bright: "#45d3c1" }, // teal
    { base: "#ff5566", bright: "#ff7079" }, // red
    { base: "#ffa640", bright: "#ffb85e" }, // orange
  ],
}

const LIGHT = {
  id: "light",
  name: "Light",
  page: "#eef0f4",
  background: "#ffffff",
  well: "#f2f3f7",
  cell: "#e7e9f0",
  panel: "#ffffff",
  panelEdge: "#d5d8e2",
  text: {
    bright: "#181b25",
    normal: "#3f4557",
    dim: "#6f7689",
    faint: "#a7adbd",
  },
  cursor: "#8b93ab",
  cursorActive: "#3f4557",
  accent: "#0091c2",
  warn: "#d92b3f",
  // A little ink rather than a lot of the background: dimming a white field with white
  // does not dim it, it bleaches whatever is on it.
  scrim: { color: "#181b25", alpha: 0.12 },
  // Higher than the dark theme's: dark text needs a paler ground under it than light
  // text needs over a dark one.
  frost: 0.9,
  // A glow laid over white does not read as light, it reads as desaturation: these
  // dot colours already have a channel at full scale, so adding to them only lifts
  // the other two and turns red into pink. The light theme therefore takes a little
  // of it - enough to soften the edge of a long chain and no more.
  bloom: 0.22,
  dots: [
    { base: "#9900cc", bright: "#bb22ee" }, // purple
    { base: "#00ccff", bright: "#22eeff" }, // blue
    { base: "#009999", bright: "#22bbbb" }, // teal
    { base: "#ff3333", bright: "#ff5555" }, // red
    { base: "#ff9933", bright: "#ffbb55" }, // orange
  ],
}

export const THEMES = { dark: DARK, light: LIGHT }
export const THEME_IDS = ["dark", "light"]
