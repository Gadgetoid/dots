# Working on Dots

How it is put together. [README.md](README.md) is the game itself, [CODE_REVIEW.md](CODE_REVIEW.md) is what to look at when reviewing a change.

```
npm install
npm run check      # lint, format check, tests
```

There is nothing to build to develop it: `index.html` loads `src/main.js` and the tests import the modules.

## Layout

```
index.html          the page, which is the canvas and nothing else
src/main.js         entry point: wires the DOM, creates everything, runs the loop
src/config.js       every tuneable, the layout maths and the input mapping
src/palette.js      the two themes, the dot colours and the shape each one wears
src/fonts.js        the faces the game can draw in, and the one that is bundled
src/board.js        the grid, the linking rules, collapse and refill
src/modes/          one file per mode, plus the puzzle levels
src/seed.js         the code a seeded board is dealt from, and how it is written
src/link.js         what a link asks for, and how a board writes itself into one
src/scales.js       the tunings a mode can play in
src/specials.js     powerup registry (the contract; nothing registered yet)
src/game.js         phases, scoring, menus, settings, per-player chain state
src/particles.js    sparks, dust, rings, flashes and score floaters
src/view.js         everything that is drawn, as renderer primitives
src/renderer.js     the rendering contract
src/glrenderer.js   the WebGL2 backend
src/shaders.js      the GLSL, kept apart from the code that compiles it
src/audio.js        synthesised sound
src/speech.js       spoken menus
src/input.js        keyboard and pointer
src/gamepad.js      pads
src/persistence.js  best scores, level and seed records, settings and bindings, in IndexedDB
src/solver.js       the puzzle search
src/analysis.js     par, floor and difficulty derived from it
src/replay.js       a seeded round packed into a link, and played back to check it
```

The view is a fixed 600x800 field letterboxed into whatever the canvas is, so every coordinate in the game is in those units and nothing has to know the window size.

## The page

`index.html` carries no comments, because it is the one file the build does not minify and every byte of it goes to every player. The things in it that are not obvious:

Nothing the player works the game with lives in the page. Every control is drawn inside the field, where a finger, a pad and a key can all reach it; a control that only exists in the page can only be reached by a pointer. What is in the page is the field and, under it, a bug link and a thank you, neither of which is part of playing.

`.stage` sets a width and lets the height follow from `aspect-ratio`. Setting both a percentage height and a ratio is over-constrained and engines disagree about which to drop - Safari keeps the ratio, makes the stage taller than the window, and `overflow: hidden` clips the board. `max-height` guards the other direction, where the footer wraps to more lines than `--below` allows: then the stage is wider than the field and the view letterboxes inside it, which is what it does anyway.

The touch properties are on `html, body` rather than on the canvas. `touch-action` has to cover the letterbox either side of the field or a finger landing there pinches the page, and on iOS that is what is honoured rather than the meta viewport's `user-scalable`. `position: fixed` on the body is for the document rubber-banding with nowhere to go. Selection and `-webkit-touch-callout` inherit, so they are set once - the callout is the one that bites, since holding a dot otherwise raises the copy and look-up sheet over the board. A canvas is an image to a drag, which `-webkit-user-drag` and the `draggable` attribute refuse between them, one because Safari honours the attribute where it ignores the property.

`role="application"` on the canvas is what stops a screen reader taking the arrow keys for its own browse cursor. The `.speak` button is a skip link, first in the tab order and invisible until focused: the field is a canvas and cannot be read out, so a player who needs the game to talk has no way to find a setting that is only drawn, and nothing can ask the browser whether that player is there.

## Drawing

Shapes are distance fields cut out of quads and antialiased with `fwidth` in the fragment shader, so an edge is a pixel wide at any canvas size and there is no multisampled target to pay for. A dot's jelly is part of that field: one damped oscillator per dot scales its radius by a two-lobed cosine, and a hint is the only thing that sets it ringing.

The chain is a field too - circles at the dots, rectangles between them, at exactly the dot radius, so a straight run has a straight outline no wider than a dot. The join is an exact union rather than a smooth one, because two shapes overlapping along their whole length are always within any smoothing distance of each other and the whole run would inflate. The smoothing is passed per link and is zero unless that link turns, so the fillet lands on the inside of a corner and nowhere else.

Bloom comes from an explicit glow layer rather than a bright-pass over the scene. Only what the view marks as glowing goes into it, which is what lets the light theme have a glowing chain without its pale background blooming.

Text is a glyph atlas rasterised from whichever face the settings ask for, with a measured advance per character per weight, so a proportional face lays out correctly and a run is summed rather than multiplied by its length.

## Colour

Each theme carries its own five dot colours, chosen by a search over OKLCH for the set whose worst pair is furthest apart under normal vision and under simulated protanopia, deuteranopia and tritanopia at once, subject to every dot clearing 3:1 against the board it sits on. One set for both themes is possible and costs about half of that separation, which is why there are two. The head of `src/palette.js` has the numbers.

## Modes

A mode is a plain object: grid size, minimum chain length, how many colours, whether it refills, an optional clock, an optional turn limit, an optional tuning, optional levels, whether it deals from a seed, plus optional hooks for choosing what it deals and judging what it left. Endless uses the hooks - it picks colours that avoid their neighbours, and if that leaves a dead board it recolours the shortest legal run back in, somewhere in the middle where it is hardest to spot. Adding a mode is a file in `src/modes/` and a line in `src/modes/index.js`.

A clock and a turn limit are the two ways a mode can be a fixed size, and they measure different things: a clock measures how fast you press and a turn limit does not, which is why the seeded mode - the one mode two players compare scores on - uses turns. Both draw the same gauge above the board.

The 32blit game's own seed generator is not reproduced. It was an LFSR with a 16 bit tap, which gives a period of 32,767 and puts every seed on one ring at a different offset, so seed N+1 deals seed N's board shifted along by one dot: fine for a number nudged with a d-pad, and not for a code people pass around. The seed feeds `mulberry32` instead, under which all 15,625 codes give distinct boards, none of them opening without a legal move.

## Levels

A level is drawn in `src/modes/levels.js`, in ASCII so it can be read and edited as the shape it is:

```
"......"
"......"
"......"
"..11.."
".1221."
".1221."
"331133"
```

A digit is a colour and a dot is an empty cell, numbered as the original game's level data numbered them. What is drawn falls, so a shape does not have to be bottom-aligned by hand, though the shipped ones are written already fallen so the file shows what the board will look like. `prettier-ignore` keeps the formatter from flattening each one onto a single line. No board appears in either set twice, checked for mirrors and recolourings as well as exact copies.

Each level carries two exact numbers:

| Field   | What it is                                                                       |
| ------- | -------------------------------------------------------------------------------- |
| `par`   | the most the level can score, over every order that clears it. A star for it     |
| `floor` | the least any clearing order scores. Equal to par means how it is played is moot |

Both are exact because the question is finite: a pop only ever takes dots off the board, so the positions reachable from a layout form a graph with no cycles and each need only be valued once, with the multiplier as part of what is valued. The largest level is about nine million positions, which is a few minutes of work, so both are written down beside the layout and what has been proved about a board goes in `data/verified-boards.json` by `tools/verify-levels.mjs`.

`test/levels.test.js` reads that file rather than walking every board on every run. It is keyed on each board's identity and the chain length it was asked about, and on a fingerprint of the rules and weights that judged it, so editing a layout by one dot, or changing what a chain pays, walks that level there and then. The chain length is part of the key rather than the fingerprint because it is part of the question and not part of the judge: the same layout at two and at three is two questions with two answers, and both can be true at once. `DOTS_REWALK_LEVELS=1` walks a couple regardless, chosen by the day, which is worth turning on after a change to the search that no fingerprint could notice.

The same test proves every level can be emptied at all, which matters because nothing refills: a badly drawn level is one a player can only lose in. It also checks the order of each ladder, which is by measured difficulty, with the last dozen or so arranged rather than sorted - all of them above everything before them, but swinging between hard and harder and finishing on the hardest board the set holds.

`src/analysis.js` walks the same graph and answers all of it at once: clearable or not, par, floor, how many orders pay par, how long the shortest clearing order is, how many openings lose the level, and what greed would do. One refinement matters. A trap that leaves a colour with a single dot on the board announces itself, since nothing refills and a player can see it as plainly as the solver can; every trap in the original seven levels is that kind, which is why they play as forgiving even though most of their moves strand the board. A trap that leaves everything still looking matchable is what makes a level hard, and those come out of the collapse several moves deep.

Which is why the newer levels were searched for. The silhouettes in `tools/find-levels.mjs` are drawn by hand, since no search knows what looks good; the colours are searched, since none of the above can be seen in a layout. Growing regions of colour rather than scattering dots took the share that can be cleared at all from 8.5% to 98%.

```
node tools/levels.mjs                    # the table for a shipped set
node tools/find-levels.mjs --out found   # look for more, until stopped
```

A set carries its own levels, its own progress key, how many of its levels are arranged rather than sorted, and optionally its own chain length. A set at three is a different puzzle on the same shapes rather than the same one made harder: the pairs are where most of a chain-of-two board's traps live, so boards at three are tighter and read more plainly, and a colour is stranded by having fewer than three dots left. `draft` marks a set still being built - its boards are held to being real, and not to being a finished ladder.

[docs/puzzle-analysis.md](docs/puzzle-analysis.md) is the whole of it: the rules that bound the problem, how a board is scored, what is worth knowing about one and why each answer is exactly computable, what that costs, and what the search does about the cost.

## Sharing a round

A finished seeded round writes itself into the link as `run`: every chain that was played, packed as a length, a first cell and two bits a step, in base64url. Thirty chains is about eighty characters.

Which is the whole of the security, and it is worth being clear about why. There is no server and no key that could be kept - anything in the bundle is readable by whoever opens the page, so a signature over a score is a signature anybody can forge, and a link that carries only a number carries nothing. What cannot be forged is a game: the board and every colour dealt into it come from the code, so a run replays to exactly one score. `src/replay.js` plays the chains back through the board's own rules with no frames in between, refusing anything that is not a legal chain, and the number it arrives at is the number the card shows. Claiming a score means handing over a game that really makes it.

The two additions must stay in step: `replay.js` and `game.js` are the same arithmetic written twice, and a link is worth nothing if they can disagree. `test/replay.test.js` plays a real round and checks its own run back against it, which is what catches that.

## Sound

The engine is Geometry II's, revoiced: sines and triangles through a low-pass, a soft-clip on the mix, and a few milliseconds of attack on every envelope, because an envelope that starts at full level clicks and a click is the one thing a mellow sound cannot have.

Slendro and pelog are given in cents rather than semitones because they are not equal-tempered scales, and flattening them onto twelve tones is most of what makes a sampled gamelan sound wrong. They are still approximations - every gamelan is tuned to itself - but of the right thing.

## Tests

They run under node with no browser: the board is pure logic, a `Game` can be advanced frame by frame, the input mappings are pure functions, the view is driven through a renderer that records what it was asked to draw instead of drawing it, and the sound engine is driven against a stub audio device.

What a unit test cannot see is a shader that will not compile, so the screenshot tool doubles as the smoke test: it poses the real game in a real browser, shoots it, and fails on any console or page error.

```
npm install --no-save puppeteer-core
node tools/screenshot.mjs
```

`puppeteer-core` is deliberately not a dependency, so `npm install` will remove it again.

## Publishing

A GitHub Actions workflow on every push to main, gated on the same checks.

```
npm run build      # _site/, with relative URLs, for a look
```

The scripts go into a directory named after the commit, which is what stops a browser serving an old game from its cache: every import in `src` is relative, so moving the directory takes the whole module graph with it and one line of `index.html` changes. The page itself cannot be versioned, since its URL is the URL people have, and GitHub Pages serves HTML with a ten minute cache - that is the longest a player can be behind.

Five entry points are bundled and minified on the way: the game, the editor, the guide and the two workers. esbuild does not follow `new Worker(new URL("./worker.js", import.meta.url))`, so a worker has to be named as an entry or it is folded into whatever imported it and then asked for by a URL with nothing at it. Each lands where its module was, because that is what `import.meta.url` resolves the fonts and the workers against.

The trade-off, measured over HTTP/2 with gzip, cold cache, time to a playable board:

|                   | requests | on the wire | 1.6Mb/s, 150ms | 12Mb/s, 40ms |
| ----------------- | -------- | ----------- | -------------- | ------------ |
| unbundled         | 34       | 130kB       | 1569ms         | 422ms        |
| bundled, minified | 2        | 41kB        | 578ms          | 211ms        |

Most of that is comments - 44% of `src`. Against it: one devDependency, and a deployed copy that is not readable. No source maps, since the readable copy is `src`.

## The other two pages

`strategy-guide.html` is a guide to playing well, not linked from the game. Its tables and boards are built from the game's own modules and its solutions come from `data/verified-boards.json`, so a level that changes takes the guide with it. A board the file does not cover is solved in a worker on the page instead.

`editor.html` is a level editor, also not linked from the game, built out of the game's own renderer, palette and analysis so a board drawn in it is drawn by the code that will draw it when it is played. It says whether the board can be cleared, what par and floor would be, roughly how hard it is, and hands over the layout ready to paste into `src/modes/levels.js` - or refuses to, if the board cannot be emptied. The analysis runs in a worker, since judging a full board takes a couple of seconds and on the page's own thread that is a couple of seconds of a dead editor after every click.

## Still to come

Powerups keyed to a dot colour, which say what they do while the cursor is over them: nudge a column sideways to line up a match that was one place out, pop every dot of a colour, that sort of thing. `src/specials.js` holds the contract and the board already has the operations they need; nothing is registered.

And more than one player, up to four, with specials that reach across the board at each other. The chain, cursor, score and multiplier are already per player, a dot records whose chain has claimed it, and every input method takes a player index, so what is left is handing out the slots.
