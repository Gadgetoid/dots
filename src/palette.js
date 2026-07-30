// The game's colour vocabulary, in two themes.
//
// Every colour the player sees is named here, so retheming is a single-file edit.
// Names describe what a colour is for, not what it looks like. Values are plain
// CSS colour strings, which the renderer parses and caches.
//
// The dot hues are the 32blit game's, which in turn are the original RaphaelJS
// game's: purple, blue, teal, red, orange. `base` is a dot at rest and `bright`
// is one in the chain, exactly the pairing the 32blit version drew with. Each theme
// carries its own set, since a saturated mid-tone that reads well on paper goes muddy
// on near-black - and one set for both grounds costs most of what separates the five.
//
// The five are chosen, not picked: a search over OKLCH for the set whose *worst pair* is
// furthest apart, under normal vision and under simulated protanopia, deuteranopia and
// tritanopia at once, subject to every dot clearing 3:1 against the board it sits on and
// no two hues landing within 34 degrees of each other. Each hue is held within 20 degrees
// of the one it replaces, so purple is still purple. Distance is measured in OKLab and the
// deficiencies with the Machado 2009 matrices, clamped back into sRGB before measuring -
// unclamped, a simulation that has merely left the gamut reads as two colours far apart.
//
// What that buys, as the worst pair in each set: 18.3 against 10.1 for the dark theme, and
// 16.9 against 12.1 for the light one, where 8 is the least a pair can differ by and still
// be told apart without a second channel to go on.
//
// `bright` is derived rather than chosen: the same hue and chroma, moved 0.07 in OKLCH
// lightness away from the ground it is drawn on - up in the dark theme, down in the light
// one. Only that far, because a linked dot is already carrying the glow layer and a pale
// bright on top of that puts the whole chain to white: the hue has to survive its own bloom.

// How many dot colours a board deals from. The themes must each list this many.
export const DOT_COLOURS = 5

// A shape per dot colour, for anyone who cannot rely on the colours.
//
// Each dot is bent slightly toward a regular polygon - `sides` of them, turned by `turn`
// radians - so it carries a second, redundant signal. Slightly, because the board should
// still read as dots: how far is CONFIG.SHAPE_STRENGTH, and every shape dents its edges by
// the same fraction of the radius whatever its side count.
//
// Which shape goes on which colour is not arbitrary. It answers the pairs the palette above
// leaves closest together, which are measured rather than guessed:
//
//   purple  triangle, point up      blue    square
//   teal    square, turned 45       red     triangle, point down
//   orange  round
//
// Teal against orange is the closest pair under a red-green deficiency in both themes, and
// it gets four corners against none. Purple against blue is the closest the dark theme
// leaves for full colour vision, and gets three corners against four. What is left weakest
// is a square against a diamond, the same shape turned - which falls on blue against teal,
// the closest pair the light theme leaves for full colour vision. Those two are far enough
// apart in lightness to carry it between them; if that pair ever needs more, the shape to
// move is teal's, since orange is marked by having no corners at all rather than by which
// ones it has.
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
    faint: "#79809a",
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
  // Deliberately uneven in lightness, which is what a red-green deficiency has left to go
  // on once it has lost the hue: teal is the brightest thing on the board and blue is the
  // dimmest, and that gap is most of why the two do not collapse into each other.
  dots: [
    { base: "#ab8efe", bright: "#b096fd" }, // purple
    { base: "#067396", bright: "#2b88ac" }, // blue
    { base: "#38e8d1", bright: "#6dfde7" }, // teal
    { base: "#d71908", bright: "#f13c29" }, // red
    { base: "#ec9f07", bright: "#feb02e" }, // orange
  ],
}

// Paper rather than paper-white. A field at full scale is the brightest thing a screen can
// do and it is being looked at for as long as a game lasts, so the whole theme is stepped
// down and warmed: the dots have to clear 3:1 against this and, measured across every
// ground from white down to a good deal dimmer than this, where it sits makes no difference
// to how far apart the five can be kept. So it is chosen for how it is to look at.
//
// The inks are warmed with it and hold their old lightness, so nothing that passed against
// a cool white stops passing here.
const LIGHT = {
  id: "light",
  name: "Light",
  page: "#e9e3d8",
  background: "#faf7f2",
  well: "#f0ece4",
  cell: "#e4dfd5",
  panel: "#fdfbf7",
  panelEdge: "#d8d1c3",
  text: {
    bright: "#1e1a14",
    normal: "#4b443a",
    dim: "#665e52",
    faint: "#847c6a",
  },
  cursor: "#8f8677",
  cursorActive: "#4b443a",
  accent: "#0091c2",
  warn: "#d92b3f",
  // A little ink rather than a lot of the background: dimming a pale field with more of its
  // own colour does not dim it, it bleaches whatever is on it.
  scrim: { color: "#1e1a14", alpha: 0.12 },
  // Higher than the dark theme's: dark text needs a paler ground under it than light
  // text needs over a dark one.
  frost: 0.9,
  // A glow laid over a pale field does not read as light, it reads as desaturation: adding
  // to a colour lifts whatever channel it has least of, which is what turns a red to pink.
  // The light theme therefore takes a little of it - enough to soften the edge of a long
  // chain and no more.
  bloom: 0.22,
  // Deeper than the dark theme's, and they have to be: a dot clearing 3:1 against paper is
  // a dot well down from it. So red is a maroon here and orange is a burnt one, which is
  // what the ground costs and the whole of what it costs.
  //
  // `bright` goes *down* from the base here where the dark theme's goes up. The name is the
  // role - the colour a dot wears in a chain - and what reads as more of a colour depends on
  // what it is being read against: away from near-black is lighter, away from paper is
  // deeper. Lifting these would walk a linked dot toward the ground it has to stand out
  // from, and took the chain under 3:1 against the well.
  dots: [
    { base: "#971ef8", bright: "#7f02d5" }, // purple
    { base: "#115785", bright: "#00436c" }, // blue
    { base: "#10919d", bright: "#037a85" }, // teal
    { base: "#8a0316", bright: "#6a000d" }, // red
    { base: "#bc670c", bright: "#a05602" }, // orange
  ],
}

export const THEMES = { dark: DARK, light: LIGHT }
export const THEME_IDS = ["dark", "light"]
