// The faces the game can draw in.
//
// The renderer rasterises whatever face it is given into its glyph atlas, so a face is a
// font stack and nothing else: see buildAtlas in glrenderer.js. What this file adds is the
// one face that is not already on the machine, and the loading it needs.
//
// A bundled face is fetched only when it is chosen. The standard one costs nothing at all -
// it is whatever monospace the system already has - so a player who never opens the setting
// never asks the server for a font, which is what keeps the page a page and its scripts.
//
// Atkinson Hyperlegible is the Braille Institute's, under the SIL Open Font License; see
// fonts/OFL.txt beside the files. It is here because it was drawn for exactly the problem
// this game has most of: telling one character from another at a glance, where nearly every
// character the game draws is a digit. A 0 from an O, a 1 from an l, a 5 from an S, a 6 from
// an 8 - the letterforms are deliberately pulled apart rather than merely made large.
//
// Only the Latin subset is bundled, which is every character the atlas holds.

const FILE = (name) => new URL(`./fonts/${name}`, import.meta.url).href

const STANDARD_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export const FONTS = [
  {
    id: "standard",
    // What the cell says, which has to fit a cell; `full` is what the hint line says.
    name: "Standard",
    full: "The system's own monospace",
    hint: "Every character the same width",
    stack: STANDARD_STACK,
    files: [],
  },
  {
    id: "atkinson",
    name: "Atkinson",
    full: "Atkinson Hyperlegible",
    hint: "Atkinson Hyperlegible, for enhanced readability",
    // The standard stack behind it, so a frame drawn before the face arrives is drawn in
    // something rather than in whatever the browser picks for an unknown family.
    stack: `"Atkinson Hyperlegible", ${STANDARD_STACK}`,
    files: [
      { weight: "400", file: "atkinson-hyperlegible-regular.woff2" },
      { weight: "700", file: "atkinson-hyperlegible-bold.woff2" },
    ],
  },
]

export const FONT_IDS = FONTS.map((font) => font.id)

const FONT_BY_ID = new Map(FONTS.map((font) => [font.id, font]))

export const fontById = (id) => FONT_BY_ID.get(id) || FONTS[0]

// Which faces are in and ready to be rasterised. A face with no files to fetch is ready by
// definition, since it is already on the machine or it is not and the stack falls through.
const ready = new Set(FONTS.filter((font) => font.files.length === 0).map((font) => font.id))
const asking = new Map()

export const fontReady = (id) => ready.has(id)

// Fetch a face, once, and hand back whether it can now be drawn in. Never rejects: a face
// that will not load leaves the game in the one it was already using, which is a game that
// looks unchanged rather than a game with no text in it.
export function ensureFont(id) {
  const font = fontById(id)
  if (ready.has(font.id)) {
    return Promise.resolve(true)
  }
  if (asking.has(font.id)) {
    return asking.get(font.id)
  }
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    return Promise.resolve(false)
  }
  const loading = Promise.all(
    font.files.map(async (entry) => {
      const face = new FontFace(font.full, `url(${FILE(entry.file)})`, { weight: entry.weight })
      await face.load()
      document.fonts.add(face)
    }),
  )
    .then(() => {
      ready.add(font.id)
      return true
    })
    .catch(() => false)
  asking.set(font.id, loading)
  return loading
}
