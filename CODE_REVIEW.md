# Code Review Instructions

Review this game codebase (DOTS - a colour-matching puzzle game, ~13.8k lines of
vanilla ES modules plus ~4.5k of tests, and no build step to develop it: `index.html`
loads `src/main.js` and the tests import the modules, while what is deployed is bundled
and minified by `tools/build.mjs`) for:

1. **Correctness** - the linking and collapse rules, the solver, the state machine
2. **Determinism** - what a seed governs and what it must not
3. **Separation of concerns** - sim / view / renderer boundaries
4. **Performance** - per-frame allocation, redundant work, GPU batching
5. **Extensibility** - cost of adding a mode, a level, a special, a scale
6. **Configurability** - is tuning reachable without reading gameplay code?
7. **Best practice** - modern idiomatic JS, dead code, error handling
8. **Comment discipline** - see below; this codebase has a house style and it is load-bearing
9. **Verification** - is a claim backed by a number, or by reading the code?
10. **Accessibility** - a _superficial_ pass only, see below

## Layout

```
config.js       CONFIG, DEFAULT_SETTINGS, MENU_NOTES, PAGE_TITLES, layout maths, input mapping
palette.js      the two themes, dot colours, per-colour shapes
math.js         pure helpers, including mulberry32
board.js        the grid, the linking rules, collapse and refill
modes/          one file per mode; the contract is documented in modes/index.js
modes/levels.js authored boards, ASCII, prettier-ignore
seed.js         the six-dot code a seeded board is dealt from
link.js         the URL grammar
solver.js       the puzzle search
analysis.js     par, floor and difficulty derived from it
replay.js       a seeded round packed into a link, and played back to check it
specials.js     powerup registry
scales.js       the tunings a mode can play in
game.js         phases, scoring, menus, settings, per-player chain state
particles.js    sparks, dust, rings, score floaters
view.js         everything drawn, as renderer primitives
renderer.js     the rendering contract
glrenderer.js   WebGL2, the only backend
shaders.js      the GLSL
audio.js        synthesised sound
speech.js       spoken menus
input.js        keyboard and pointer
gamepad.js      pads
persistence.js  IndexedDB, one key per thing remembered
main.js         wiring
```

Outside the game: `tools/` the level search, the verifier, the build and the screenshot
harness; `editor/` and `guide/` separate pages; `docs/puzzle-analysis.md` the puzzle
problem space; `data/verified-boards.json` proved par and floor per board

## How to verify

Run `npm run check` (eslint + prettier + 180 tests) before and after any change.

The game is headless: `new Game()` works under plain node, so `game.start(mode)` and
`game.advance(1/60)` in a loop will reproduce and **quantify** most bugs. Do that rather
than reasoning from the source. `test/game.test.js` has the helpers (`advanceUntil`,
`settle`, `linkLongest`). Traps that have each cost a wasted probe:

- **There is no `indexedDB` under node.** `load()` swallows its own failure, so
  `#restoreState`'s body never runs and every test is silently a first-time player with
  empty `progress` and `best`. Two real bugs lived in that gap. Stand the fake store in
  `test/launch.test.js` up rather than constructing a bare `Game`.
- **Letting go of a chain is `linkRelease`, not `releaseChain`.** `popChain` spends one
  without the release semantics; which you want depends on the link setting.
- **A cap makes a measurement look flat.** `reachFrom(dot, cap)`, `longestChain(budget)`
  and the solver's `MOVE_LIMIT` all truncate. A reach that reported the same number for
  every long run was a cap, not a search bug.
- **"Too big to judge" is an answer.** `clearable` is three-valued on purpose; treat an
  unknown as unknown rather than as false.
- **Column decomposition is sound for clearability and unsound for par.** Merging
  per-part multisets assumes chains reorder freely within a part; it claimed 2577 against
  a real 2450. `analysis.js` says so. Do not re-propose it.
- **`Board.load` digits are 1-based; the tests' `boardFrom` takes raw 0-based indices.**
  A layout that looks like a test fixture is off by one from one.
- **Cosmetic randomness must stay unseeded.** Particles and audio detune go through
  `randRange` on `Math.random`; only the board's `random` is seeded. A spark landing in
  the same place twice is not what anyone means by the same board.
- **The levels suite reads what it knows out of `data/verified-boards.json`**, keyed on each
  board and the chain length it was asked about, and on a fingerprint of the rules that judged it, so editing a layout or changing what
  a chain pays walks that level here and now. `DOTS_REWALK_LEVELS=1` walks a couple regardless,
  chosen by the day, which takes anything from seconds to several minutes and is worth it after
  a change to the search that no fingerprint could notice. `tools/verify-levels.mjs` is the
  thorough way.
- **`replay.js` and `popChain` are the same arithmetic written twice.** A shared link is a
  score somebody else's copy of the game works out for itself, so a scoring change made in one
  and not the other makes every existing link read as a forgery. `test/replay.test.js` plays a
  round and checks its own run back.
- **A run is checked, never believed.** Nothing in a link can be signed - the bundle is
  readable - so anything a link claims has to be recomputed from the chains it carries. Do not
  add a field to the grammar that is taken at its word.
- **Level names are user-facing and get renamed.** Links slug them, so two names that
  slug alike would silently make one unreachable; there is a test for it.
- **A banner is drawn before the menu panel**, so one raised while a page is open is
  behind the glass. Use a page's own notice line instead.

For rendering, `test/view.test.js` drives every screen through a recording renderer and
insists nothing handed to it is NaN, undefined or a negative size - a NaN reaches the
vertex positions and the shape vanishes without a word. For anything beyond that, drive
the real page: `node tools/screenshot.mjs` is also the smoke test, and it fails on a
shader that will not compile or a module that will not load, neither of which a unit test
sees. Screenshot and actually look at it.

Two traps in that harness. Poses run from the title screen, which is **not** where the
game opens any more - it opens in play, off a promise waiting on storage, so wait for
`game.launched` and pose from `toTitle()`. And puppeteer pages share the profile, so any
page load writes settings: a first-time-player check has to run first or it reads as a
returning one.

`syncLink` rewrites the query string on the first frame, so anything reading
`location.search` must capture it before the loop starts.

## Comments

The house style is narrow and deliberate, so a review should flag departures from it as
readily as it flags a bug:

- Comments document current behaviour. Never past state, never what changed - that
  belongs in the commit message.
- Document layout and structure where it is not obvious, disambiguate what is genuinely
  tricky, and document settings concisely.
- No em-dashes or other non-typeable unicode, anywhere in code, comments or markdown.
- "rather than" earns its place only where the behaviour it contrasts with is surprising.
- Descriptive names, readable structure, nothing dense or minified.

## Accessibility, superficially

A light pass for obvious wins, not an audit. Already in place, so do not report these as
missing: spoken menus, with a DOM toggle placed above the canvas in tab order because a
canvas cannot be read out; `role="application"` and an `aria-label` on the canvas, and
`lang="en"` on the page; a per-colour shape setting for anyone who cannot rely on colour;
a reduced-motion setting, taken from `prefers-reduced-motion` until the row is pressed;
brightness scaling the whole composite; a light theme; hints;
every control rebindable per device from a page that names what is bound; and a cursor
tone whose pitch carries how many dots are reachable.

Worth a look, roughly by how cheap the fix would be:

- **Colour as the only channel.** The shape setting exists but is off by default. Do the
  chain, the multiplier, the star and the locked-level padlock survive desaturation? A
  greyscale screenshot answers it in one look.
- **Contrast.** Check the faint text entries at their real drawn sizes against the
  background they actually sit on, not against the theme's base.
- **Flashing.** Nothing periodic is over the 3Hz line usually cited: the cursor breath is
  0.54Hz and the banner fades once. A chain unzipping is, at 22Hz - `POP_STAGGER` 45ms
  against a `POP_FLASH_LIFE` of 160ms, so nine flashes over 400ms for a nine dot chain.
  Local rather than full-field, and a reduced-motion session throws none of it, which is
  where that is left.
- **Timing.** Rush is a fixed 90 seconds with no slow-down.

## Output

Order findings by impact, not by file. For each: the concrete failure (inputs to wrong
result), and a measurement where one is cheap to take. Separate real defects from taste.
Say plainly when something is already fine - do not pad. Flag anything that is a
difficulty or feel decision rather than a bug, and leave those to me.
