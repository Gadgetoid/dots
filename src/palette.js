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

// Blend two "#rrggbb" colours, `t` running 0 at `from` to 1 at `to`.
export function mixColour(from, to, t) {
  const channel = (hex, at) => parseInt(hex.slice(at, at + 2), 16)
  const blend = (at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * t)
  return `rgb(${blend(1)},${blend(3)},${blend(5)})`
}

// How many dot colours a board deals from. The themes must each list this many.
export const DOT_COLOURS = 5

const DARK = {
  id: "dark",
  name: "DARK",
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
  name: "LIGHT",
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
  // A glow laid over white only greys the picture, so the light theme takes a
  // fraction of it: enough to soften a long chain, not enough to fog the board.
  bloom: 0.5,
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
