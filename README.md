# Dots

Draw a line through dots of one colour to pop them out of existence.

Dots started life around 2013 as a RaphaelJS toy - SVG circles, a drag handler and
a 90 second clock. Very heavily inspired by the 2013 iPhone game of the same name, which in turn was basically a minimalist Bejeweled (Grandma would be proud <3). It got embedded into a couple of websites where people played and enjoyed it, but never amounted to more than that.

It was later rewritten in C++ for the [32blit](https://32blit.com)
handheld, which gained it a cursor, a score multiplier and a proper lose condition,
and lost it antialiasing. This is that game again in WebGL2: the same five colours
and the same cubed scoring, with the graphics the STM32 could never have managed.

Along for the ride come a slew of visual accessibility options, hopefully opening up the game for more players, and perhaps another thirteen years of life.

Two of the three still exist to compare against: the 32blit version is in
[32blit-dots](https://github.com/gadgetoid/32blit-dots) and the original in
[raphaeljs-dots](https://github.com/gadgetoid/raphaeljs-dots).

## Screenshots

|                                                        |                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| ![A chain of six dots, glowing](screenshots/board.png) | ![A chain unzipping](screenshots/popping.png)                 |
| ![The light theme, mid chain](screenshots/light.png)   | ![The board turned down for the night](screenshots/night.png) |
| ![An authored puzzle level](screenshots/puzzle.png)    | ![The pause menu](screenshots/menu.png)                       |

## Playing

Link two or more dots of one colour through cardinal neighbours - never diagonals -
and pop them. A chain is worth the cube of its length, so six dots taken together
are worth far more than three pairs. Clear four or more and the next chain scores at
a multiplier.

| Device   | Controls                                                                           |
| -------- | ---------------------------------------------------------------------------------- |
| Keyboard | Arrows or WASD move, space links and pops, X drops the chain, escape for the menu  |
| Gamepad  | D-pad or left stick move, A links and pops, B drops the chain, select for the menu |
| Touch    | Drag across dots to link them, let go to pop. The pause button is under the board  |

The 32blit version held A down while moving and popped on release, so a slip of the
thumb threw a chain away. Here a press starts the chain and it stays: moving onto a
neighbour extends it, moving back retracts it, a second press pops it and the drop
button is the only other thing that can spend it. Every control is rebindable from the
controls page, per device.

Everything else is in the menu, which is the title screen, the pause screen and the
game-over screen alike: choose a mode and it starts, and the theme, brightness and
sound are rows of options that can be tapped, walked onto with left and right, or
pressed - the theme as two little boards to pick between rather than a word. Brightness
scales the whole frame in the composite pass, bloom included, for playing in the dark.

The page holds nothing but the canvas: no buttons and no help line. Every control the
player has is drawn inside the field, because a button in the page can only be pressed
by a pointer and this game is played as often with a pad or a keyboard.

## Modes

| Mode        | Board | Chain | What is different                                      |
| ----------- | ----- | ----- | ------------------------------------------------------ |
| Classic     | 6x6   | 2     | The 32blit game. Refills until nothing matches         |
| Rush        | 6x6   | 2     | Ninety seconds, as the original browser game gave      |
| Long game   | 8x8   | 3     | A pair is not a move                                   |
| Endless     | 7x7   | 2     | Deals against itself: matches are hidden, never absent |
| Elimination | 6x6   | 2     | A colour cleared off the board never comes back        |
| Clear out   | 6x7   | 2     | No refill, and the board is random. Whittle it down    |
| Puzzle      | 6x7   | 2     | Seven designed boards, cleared one after another       |

The last three all come from the original browser game, which had `puzzle`,
`elimination` and an endless default. Elimination refills only with colours still in
play, so the pool shrinks as the game goes on and winning means taking the final colour
off the board. Puzzle is the authored one: nothing refills, so whether a level can be
emptied at all depends on the order the chains are taken in, because every pop collapses
the columns under it.

Clear out is the same premise on a random board, and a random board usually cannot be
emptied at all - at sizes small enough to search exhaustively, only about one dealt board
in ten can be, and the rest strand a colour whatever order they are taken in. So it asks
how far a board can be whittled down and reports what was left on it, and clearing one
outright is an occasional thing worth a mention. If you want a board that is certainly
clearable, that is what the designed levels are for.

A mode is a plain object - grid size, minimum chain length, how many colours, whether
it refills, an optional clock, an optional tuning, optional levels - plus optional
hooks for choosing what it deals and judging what it left. Endless uses the hooks: it
picks colours that avoid their neighbours, so nothing is handed to you, and if that
leaves a dead board it recolours the shortest legal run back in, somewhere in the
middle where it is hardest to spot. Adding a mode is a file in `src/modes/` and a line
in `src/modes/index.js`.

### Levels

A level is drawn rather than written, in `src/modes/levels.js`:

```
"......"
"......"
"......"
"..11.."
".1221."
".1221."
"331133"
```

A digit is a colour and a dot is an empty cell, numbered as the original game's level
data numbered them. What is drawn is then allowed to fall, so a shape does not have to
be bottom-aligned by hand.

Since nothing refills, a badly drawn level is one the player can only lose in, so
`test/solver.js` searches each layout for a sequence of chains that empties it and the
test fails if it cannot find one. Every shipped level is therefore provably clearable,
and the last one is deliberately not clearable by simply taking the longest chain every
time.

Each level also carries a `par`: the most it can score over every order that clears it.
That is an exact answer to an exact question, because a pop only ever takes dots off the
board - the positions reachable from a layout form a graph with no cycles, so each one
need only be valued once, with the multiplier as part of what is valued. The largest
level is about forty thousand positions, which is a second of work: too slow for a frame,
so it is written down beside the layout and the test recomputes it, and a number that has
drifted from its layout fails rather than quietly misleading a player. The board shows it
as a target while a level is being played.

## Sound

Linking and popping walk up a scale, so the scale is most of the character of a mode:
the same board sounds patient in hirajoshi and impatient in blues. A mode names a root
and a scale from `src/scales.js`, or asks for `"random"` and gets a different voice
every session, which is what Endless does.

Slendro and pelog are given in cents rather than semitones because they are not
equal-tempered scales, and flattening them onto twelve tones is most of what makes a
sampled gamelan sound wrong. They are still approximations - every gamelan is tuned to
itself - but of the right thing. Puzzle plays in slendro.

The engine underneath is Geometry II's, revoiced: sines and triangles through a
low-pass, a soft-clip on the mix, and a few milliseconds of attack on every envelope,
because an envelope that starts at full level clicks and a click is the one thing a
mellow sound cannot have.

## How it is built

```
index.html          the page, which is the canvas and nothing else
src/main.js         entry point: wires the DOM, creates everything, runs the loop
src/config.js       every tuneable, the layout maths and the input mapping
src/palette.js      the two themes
src/board.js        the grid, the linking rules, collapse and refill
src/modes/          one file per mode, plus the puzzle levels
src/scales.js       the tunings a mode can play in
src/specials.js     powerup registry (the contract; nothing registered yet)
src/game.js         phases, scoring, menus, settings, per-player chain state
src/particles.js    sparks, dust, rings, flashes and score floaters
src/view.js         everything that is drawn, as renderer primitives
src/renderer.js     the rendering contract
src/glrenderer.js   the WebGL2 backend
src/shaders.js      the GLSL, kept apart from the code that compiles it
src/audio.js        synthesised sound
src/input.js        keyboard and pointer
src/gamepad.js      pads
src/persistence.js  best scores, settings and bindings, in IndexedDB
```

The view is a fixed 600x800 field letterboxed into whatever the canvas is, so every
coordinate in the game is in those units and nothing has to know the window size.

Shapes are distance fields cut out of quads and antialiased with `fwidth` in the
fragment shader, so an edge is a pixel wide at any canvas size and there is no
multisampled target to pay for. A dot's jelly is part of that field: one damped
oscillator per dot scales its radius by a two-lobed cosine, so linking, landing or a
neighbour popping sets it ringing and the dot squashes and recovers.

The chain is a field too - circles at the dots, rectangles between them, at exactly the
dot radius, so a straight run has a straight outline no wider than a dot. The join is
an exact union rather than a smooth one, because two shapes overlapping along their
whole length are always within any smoothing distance of each other and the whole run
would inflate; the smoothing is passed per link and is zero unless that link turns, so
the fillet lands on the inside of a corner and nowhere else.

Bloom comes from an explicit glow layer rather than a bright-pass over the scene.
Only what the view marks as glowing goes into it, which is what lets the light theme
have a glowing chain without its white background blooming, and it means the glow
building as a chain grows is exactly the length of the chain and nothing else.

## Development

```
npm install
npm run check      # lint, format check, tests
```

The tests run under node with no browser: the board is pure logic, a `Game` can be
advanced frame by frame, the input mappings are pure functions, and the sound engine
is driven against a stub audio device.

What a unit test cannot see is a shader that will not compile, so the screenshot tool
doubles as the smoke test - it poses the real game in a real browser, shoots it, and
fails on any console or page error:

```
npm install --no-save puppeteer-core
node tools/screenshot.mjs
```

## Still to come

Powerups keyed to a dot colour, which say what they do while the cursor is over them:
nudge a column sideways to line up a match that was one place out, pop every dot of a
colour, that sort of thing. `src/specials.js` holds the contract and the board already
has the operations they need; nothing is registered.

And more than one player, up to four, with specials that reach across the board at
each other. The chain, cursor, score and multiplier are already per player, a dot
records whose chain has claimed it, and every input method takes a player index, so
what is left is handing out the slots.

## On AI

Like [GEOMETRY II](https://github.com/gadgetoid/geometry) before it, this was built
with heavy assistance from, and detailed direction of, Claude Code. The 32blit game
and the RaphaelJS one before it are mine; this is them again, with the graphics I
wanted at the time and did not have the CPU or the patience for.
