// The tunings the game plays in.
//
// Linking and popping dots walk up a scale, so the scale is the character of a mode's
// sound: the same board sounds patient in hirajoshi and impatient in blues. A mode
// names a root and a scale, or asks for a random one, and gets a different voice
// without a line of audio code.
//
// A scale is given either as `degrees` in semitones, or as `cents` where equal
// temperament is the wrong answer. Gamelan tunings in particular are not 12-TET and
// flattening them to it is most of what makes a sampled gamelan sound wrong, so
// slendro and pelog here are given in cents, measured from the middle of the range
// real instruments are tuned across. They are still approximations - every gamelan is
// tuned to itself - but they are approximations of the right thing.

const CENTS_PER_SEMITONE = 100

// A note name to a frequency, from A4 = 440. Accepts a letter, an optional sharp or
// flat, and an octave: "G3", "Bb3", "C#4".
export function noteFrequency(name) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim())
  if (!match) {
    throw new Error(`not a note name: ${name}`)
  }
  const naturals = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0
  const semitone = naturals[match[1].toLowerCase()] + accidental
  const octave = Number(match[3])
  // MIDI note 69 is A4; 12 semitones to the octave, C being the start of one.
  const midi = (octave + 1) * 12 + semitone
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export const SCALES = [
  {
    id: "minorPentatonic",
    name: "Minor pentatonic",
    // The one the game has always used. Five notes, no interval that can clash, which
    // is why a chain of any length walks up it and still sounds deliberate.
    degrees: [0, 3, 5, 7, 10],
  },
  {
    id: "majorPentatonic",
    name: "Major pentatonic",
    degrees: [0, 2, 4, 7, 9],
  },
  {
    id: "blues",
    name: "Blues",
    // The minor pentatonic with the flat fifth wedged in. That note between the
    // fourth and the fifth is the whole point: a long chain leans on it on the way up.
    degrees: [0, 3, 5, 6, 7, 10],
  },
  {
    id: "hirajoshi",
    name: "Hirajoshi",
    // Japanese koto tuning. Two semitone steps in five notes, which is what makes it
    // sound still rather than cheerful.
    degrees: [0, 2, 3, 7, 8],
  },
  {
    id: "insen",
    name: "Insen",
    // Also Japanese, and darker: a flat second straight off the root.
    degrees: [0, 1, 5, 7, 10],
  },
  {
    id: "iwato",
    name: "Iwato",
    degrees: [0, 1, 5, 6, 10],
  },
  {
    id: "kumoi",
    name: "Kumoi",
    degrees: [0, 2, 3, 7, 9],
  },
  {
    id: "hijaz",
    name: "Hijaz",
    // The maqam. The semitone-then-augmented-second off the root is the sound
    // everything else in this list is not.
    degrees: [0, 1, 4, 5, 7, 8, 10],
  },
  {
    id: "bhairav",
    name: "Bhairav",
    // The raga's scale, flat second and flat sixth against natural thirds and
    // sevenths. Sometimes called the double harmonic.
    degrees: [0, 1, 4, 5, 7, 8, 11],
  },
  {
    id: "slendro",
    name: "Slendro",
    // Javanese, five roughly even steps across the octave - which is why it cannot be
    // written in semitones: even steps of 240 cents are not any 12-TET interval.
    cents: [0, 231, 474, 717, 955],
  },
  {
    id: "pelog",
    name: "Pelog",
    // The other Javanese tuning, and deliberately uneven: two narrow steps and two
    // wide ones. This is the five-note subset a bar of it is usually played in.
    cents: [0, 137, 316, 702, 814],
  },
  {
    id: "wholeTone",
    name: "Whole tone",
    degrees: [0, 2, 4, 6, 8, 10],
  },
]

export const SCALE_BY_ID = new Map(SCALES.map((scale) => [scale.id, scale]))

// Roots a random tuning may be built on. Kept low and narrow: a chain climbs two
// octaves at most, and anything rooted higher than this ends up shrill by the top of
// a long one.
export const RANDOM_ROOTS = ["F3", "G3", "A3", "Bb3", "C4", "D4"]

// The game's default voice, and what the 32blit-era sound effectively was.
export const DEFAULT_TUNING = { root: "D4", scale: "minorPentatonic" }

// What the menus are tuned to, which is deliberately not the mode's own root. Walking the
// mode grid re-tunes the board to whichever mode the cursor is over, and a menu whose
// pitches moved with it would have no note of its own for anything: the same item would
// sound different depending on what had been looked at just before it.
export const MENU_ROOT = "D4"

// How many octaves a run may climb before it stops rising. A twenty dot chain would
// otherwise finish somewhere only a dog would enjoy.
const OCTAVE_LIMIT = 2

// A tuning as the sound engine wants it: a root in Hz and the frequency ratio of each
// step, already wrapped into octaves and bounded.
export function buildTuning({ root, scale } = DEFAULT_TUNING) {
  const entry = SCALE_BY_ID.get(scale) || SCALE_BY_ID.get(DEFAULT_TUNING.scale)
  const cents = entry.cents || entry.degrees.map((step) => step * CENTS_PER_SEMITONE)
  const rootHz = noteFrequency(root)
  const ratios = []
  for (let octave = 0; octave <= OCTAVE_LIMIT; octave++) {
    for (const step of cents) {
      ratios.push(Math.pow(2, octave + step / 1200))
    }
  }
  return { root, rootHz, scale: entry.id, name: entry.name, ratios }
}

// What a mode asked for. A mode may name a root and a scale, ask for "random" and get
// a different voice every session, or say nothing and get the default.
export function resolveTuning(spec, random = Math.random) {
  if (spec === "random") {
    return buildTuning({
      root: RANDOM_ROOTS[Math.floor(random() * RANDOM_ROOTS.length)],
      scale: SCALES[Math.floor(random() * SCALES.length)].id,
    })
  }
  if (!spec) {
    return buildTuning(DEFAULT_TUNING)
  }
  return buildTuning({ ...DEFAULT_TUNING, ...spec })
}
