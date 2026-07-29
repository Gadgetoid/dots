// Powerups that ride on a dot.
//
// Nothing is registered yet: this is the contract and the machinery around it, so
// adding one is an entry in SPECIALS and nothing else. The board deals them, the
// view draws whatever marker an entry names, and the game runs `apply` when one
// fires. None of those three has to know what any particular special does.
//
// A special is keyed to a dot colour, which is the point of them: a board with a
// nudge sitting on a blue dot says "blue is worth chasing right now" at a glance,
// and the colour it is on is the colour the chain that takes it has to be.
//
// An entry looks like this:
//
//   {
//     id: "nudge",
//     name: "NUDGE",
//     // One line, shown while the cursor is over the dot carrying it. This is the
//     // whole of how a player learns what a special is, so it says what it does
//     // rather than what it is called.
//     blurb: "SHIFT A COLUMN ONE PLACE SIDEWAYS",
//     marker: "arrows",        // which glyph the view draws on the dot
//     colours: [1],            // dot colours it may ride on, or null for any
//     weight: 1,               // relative chance against the other entries
//     trigger: "pop",          // "pop" fires as its dot goes, "held" is banked
//     // What it does, through the board and game APIs rather than by reaching
//     // into their state. `context` carries:
//     //   board    the board it fired on
//     //   game     for score, sound and the particle system
//     //   player   whose chain took it
//     //   dot      the dot it was riding, already removed from the grid
//     //   opponents the other players, for a special that acts on them
//     apply(context) {},
//   }
//
// The two the game is aiming at first: NUDGE, which shifts a column sideways to
// line up a match that was one place out, and POP ALL, which takes every dot of
// one colour off the board. Both are board operations rather than special cases:
// Board.nudgeColumn and Board.cellsOfColour are there for them.
export const SPECIALS = []

export const SPECIAL_BY_ID = new Map(SPECIALS.map((special) => [special.id, special]))

// Which specials may ride on a given dot colour.
export const specialsForColour = (colour) =>
  SPECIALS.filter((special) => !special.colours || special.colours.includes(colour))

// Pick a special for a dot of this colour, or null. `chance` is the mode's, so a
// mode with no specials passes zero and never sees one; with nothing registered
// this returns null whatever it is asked.
export function dealSpecial(colour, chance, random = Math.random) {
  if (chance <= 0 || random() >= chance) {
    return null
  }
  const candidates = specialsForColour(colour)
  if (candidates.length === 0) {
    return null
  }
  let total = 0
  for (const candidate of candidates) {
    total += candidate.weight ?? 1
  }
  let roll = random() * total
  for (const candidate of candidates) {
    roll -= candidate.weight ?? 1
    if (roll <= 0) {
      return candidate.id
    }
  }
  return candidates[candidates.length - 1].id
}
