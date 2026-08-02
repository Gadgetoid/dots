# Dots

Match dots with a simple swipe or master the field with precision gamepad/keyboard taps. Pop a chain out of existence and keep your score multiplier high for big numbers and perfect puzzles.

(ﾉ´ヮ´)ﾉ\*:・ﾟ✧ **[Play it here](https://gadgetoid.github.io/dots/)**

Dots started life around 2013 as a RaphaelJS toy - SVG circles, a drag handler and a 90 second clock. It was very heavily inspired by the 2013 iPhone game of the same name, which in turn was basically a minimalist Bejeweled (Grandma would be proud <3). It got embedded into a couple of websites where people played and enjoyed it, but it never amounted to more than that.

It was later rewritten in C++ for the [32blit](https://32blit.com) handheld, which gained it button input, a score multiplier and a proper lose condition, and lost it antialiasing. This is that game again in WebGL2: the same five colours, the same scoring curve turned up a notch, and the graphics the STM32 could never have managed.

Along for the ride come a slew of visual accessibility options, hopefully opening up the game for more players, and perhaps another thirteen years of life.

The previous iterations still exist if you're curious; the 32blit version is in [32blit-dots](https://github.com/gadgetoid/32blit-dots) and the original in [raphaeljs-dots](https://github.com/gadgetoid/raphaeljs-dots).

## Screenshots

|                                                            |                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| ![A chain of six dots, glowing](screenshots/board.png)     | ![A chain unzipping](screenshots/popping.png)                         |
| ![The light theme, mid chain](screenshots/light.png)       | ![The board turned down for the night](screenshots/night.png)         |
| ![An authored puzzle level](screenshots/puzzle.png)        | ![The pause menu](screenshots/menu.png)                               |
| ![The puzzle picker](screenshots/levels.png)               | ![The settings page](screenshots/settings.png)                        |
| ![A level cleared, with its star](screenshots/cleared.png) | ![A seeded round, turns left above the board](screenshots/seeded.png) |
| ![A shared round's score card](screenshots/card.png)       | ![The game over screen](screenshots/over.png)                         |

## Playing

Link two or more dots of one colour through cardinal neighbours and pop them. A chain is worth the fourth power of its length, so one chain of six dots is worth twenty-seven times what three pairs pay. Clear four or more and the next chain scores at a multiplier.

| Device   | Controls                                                                           |
| -------- | ---------------------------------------------------------------------------------- |
| Keyboard | Arrows or WASD move, space links and pops, X drops the chain, escape for the menu  |
| Gamepad  | D-pad or left stick move, A links and pops, B drops the chain, select for the menu |
| Touch    | Drag across dots to link them, let go to pop. The pause button is under the board  |

Settings include: two themes, three brightnesses for playing in the dark, a shape per colour for anyone who cannot rely on the colours alone, reduced motion, spoken menus, and a choice of typeface.

A returning player carries on with the mode they last played, and a first-time player gets the seeded board of the day.

## Links

Any board can be linked to:

| Link                  | Opens                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `?seed`               | the seeded mode on today's board                                           |
| `?seed=314522`        | the seeded mode on that code                                               |
| `?seed=314522&run=..` | a finished seeded round on that code, as a score card                      |
| `?mode=rush`          | that mode, by id, as `src/modes/` names it                                 |
| `?puzzle=9`           | puzzle level 9 of the set being played, counted from one as the HUD counts |
| `?puzzle=comb`        | that puzzle level by name, in whichever set holds it                       |

Just copy the current URL to share a board. Note that today's seeded board writes a valueless `?seed` rather than its code, so you always get the latest board of the day.

A finished seeded round adds `run`, which is every chain you played packed into about eighty characters, and the score card at the end of one has a button that copies the lot. Whoever opens it doesn't have to take your word for the score: their copy of the game plays your chains back against the board the code deals and works the number out itself. There's no server here and no key that could be kept secret in a page anyone can read the source of, so a signature would be worthless - but a game can't be faked, only played.

## Modes

| Mode        | Board | Chain | What is different                                      |
| ----------- | ----- | ----- | ------------------------------------------------------ |
| Classic     | 6x6   | 2     | The 32blit game. Refills until nothing matches         |
| Rush        | 6x6   | 2     | Ninety seconds, as the original browser game gave      |
| Long game   | 8x8   | 3     | A pair is not a move                                   |
| Endless     | 7x7   | 2     | Deals against itself: matches are hidden, never absent |
| Elimination | 6x6   | 2     | A colour cleared off the board never comes back        |
| Clear out   | 6x7   | 2     | No refill, and the board is random. Whittle it down    |
| Puzzle      | 6x7   | 2-3   | Designed boards, in ladders, cleared one after another |
| Seeded      | 6x6   | 2     | The same board and thirty turns for everyone           |

The last three all come from the original browser game, which had `puzzle`, `elimination` and a dangerously addictive Endless default. **Elimination** refills only with colours still in play, so the pool shrinks as the game goes on. Take the final colour off the board to win.

**Puzzle** is the place to find a challenge: nothing refills, order counts and pitfalls abound because every pop collapses the columns under it. Every level has a par - the most any clearing order can score - and reaching it earns a star. Leave a colour with fewer dots than a chain needs and the level is over there and then, because those dots can never be matched and the board can no longer be emptied. Clearing one stops on a page that says what it paid and what it cost, so a level cleared short of its par is one you can go straight back to. Two sets of 52 puzzles give you somewhere to go if you get stuck, picked from the strip at the top of the puzzle list. A third is being built, at chains of three, where a pair is not a move at all.

**Clear out** is the same premise on a random board, and a random board usually cannot be emptied at all - at sizes small enough to search exhaustively, only about one dealt board in ten can be, and the rest strand a colour whatever order they are taken in. So it asks how far a board can be whittled down and reports what was left on it, and clearing one outright is an occasional thing worth a mention. If you want a board that is certainly clearable, that is what the designed levels are for.

**Seeded** is classic rules dealt from a number, inspired by the 32blit version: the board and every colour dealt after it come from one seed. Two players with the same code play the same dots and the only thing between them is their skill and their score. A code is six dots, written as six digits 1 to 5 for a total of 15,625 possible boards, entered by pressing the dots round the colours or by typing the digits, and shared as a link. Every day there's a new seed everyone shares by default, and your best score is remembered per code.

A round is thirty turns rather than a clock, so it's the same length for everyone however fast they press, and it ends on a score card marked out of five stars. The stars are what the average turn paid: three dots a turn earns one and seven earns all five, and holding the multiplier up counts as much as making the chains longer.

## Sound

Linking and popping walk up a scale, so the scale is most of the character of a mode: the same board sounds patient in hirajoshi and impatient in blues. A mode names a root and a scale, or asks for a random one and gets a different voice every session, like Endless mode. Puzzle plays in slendro.

The menus have their own tuning, a note per item, so a page can be walked by ear. With spoken menus on they read themselves out too, and - in game - the cursor's own tone carries how many dots it could reach from where it is.

## Elsewhere in here

[strategy-guide.html](https://gadgetoid.github.io/dots/strategy-guide.html) (MAJOR SPOILERS) is a guide to playing well: what a chain pays, what the sounds tell you, the traps, and an animated solution to every level behind a spoiler.

[DEVELOPMENT.md](DEVELOPMENT.md) is how it is put together, and [docs/puzzle-analysis.md](docs/puzzle-analysis.md) is the puzzle problem space in full.

## On AI

Like [GEOMETRY II](https://github.com/gadgetoid/geometry) before it, this was built with heavy assistance from, and detailed direction of, Claude Code. The 32blit game and the RaphaelJS one before it were written the good ol' fashioned way, many years ago. This is a re-imagining of a re-imagining of Dots, faithful to the original two versions but with the completeness I never quite managed to achieve on my own.
