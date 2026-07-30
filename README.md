# Dots

Draw a line through dots of one colour to pop them out of existence.

**[Play it here](https://gadgetoid.github.io/dots/)** - it needs WebGL2 and nothing else.

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
| ![The puzzle picker](screenshots/levels.png)           | ![The settings page](screenshots/settings.png)                |

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
game-over screen alike. The settings are rows of options that can be tapped, walked onto
with left and right, or pressed: two themes, three brightnesses for playing in the dark, a
shape per colour for anyone who cannot rely on the colours alone, reduced motion, spoken
menus, and a choice of typeface.

The page holds nothing but the canvas: no buttons and no help line. Every control the
player has is drawn inside the field, because a button in the page can only be pressed
by a pointer and this game is played as often with a pad or a keyboard.

Opening the game starts a game. A player who has been here before carries on with the mode
they last played, and a first-time player gets the seeded board of the day, which is the one
everybody else is on. The title screen is still there behind Quit to title; it is a page to
be left rather than a toll to be paid.

## Links

Any board can be linked to, all in the query string so a link survives being served from a
subpath and needs no rewrite rules:

| Link           | Opens                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| `?seed`        | the seeded mode on today's board                                           |
| `?seed=314522` | the seeded mode on that code                                               |
| `?mode=rush`   | that mode, by id, as `src/modes/` names it                                 |
| `?puzzle=9`    | puzzle level 9 of the set being played, counted from one as the HUD counts |
| `?puzzle=comb` | that puzzle level by name, in whichever set holds it                       |

The game writes the link for whatever is being played back into the address bar, so copying
the URL is the whole of sharing a board. Today's seeded board writes a valueless `?seed`
rather than its code: pinning the code would mean a reload tomorrow dealt yesterday's board,
and a link passed on would mean the board of the day it was copied instead of the board of
the day.

A link is honoured or refused, never approximated - a link that quietly opened a different
board from the one it names would be worse than one that failed. A puzzle nobody has reached
yet opens the picker with a line saying which level was asked for, since dropping a player
into a level they have not climbed to would give away the ladder.

## Modes

| Mode        | Board | Chain | What is different                                       |
| ----------- | ----- | ----- | ------------------------------------------------------- |
| Classic     | 6x6   | 2     | The 32blit game. Refills until nothing matches          |
| Rush        | 6x6   | 2     | Ninety seconds, as the original browser game gave       |
| Long game   | 8x8   | 3     | A pair is not a move                                    |
| Endless     | 7x7   | 2     | Deals against itself: matches are hidden, never absent  |
| Elimination | 6x6   | 2     | A colour cleared off the board never comes back         |
| Clear out   | 6x7   | 2     | No refill, and the board is random. Whittle it down     |
| Puzzle      | 6x7   | 2     | Designed boards, in two sets, cleared one after another |
| Seeded      | 6x6   | 2     | The same board for everyone holding the code            |

The last three all come from the original browser game, which had `puzzle`,
`elimination` and an endless default. Elimination refills only with colours still in
play, so the pool shrinks as the game goes on and winning means taking the final colour
off the board.

Puzzle is the authored one: nothing refills, so whether a level can be emptied at all
depends on the order the chains are taken in, because every pop collapses the columns under
it. Every level has a par - the most any clearing order can score, worked out exactly rather
than picked - and reaching it earns a star. There are two sets of fifty-two, and the button
at the foot of the picker swaps between them: two ladders rather than one long one, each
opening on a warm up and ending on the hardest board it holds, each remembering how far it
got on its own, so a player stuck on one can go and play the other.

Clear out is the same premise on a random board, and a random board usually cannot be
emptied at all - at sizes small enough to search exhaustively, only about one dealt board
in ten can be, and the rest strand a colour whatever order they are taken in. So it asks
how far a board can be whittled down and reports what was left on it, and clearing one
outright is an occasional thing worth a mention. If you want a board that is certainly
clearable, that is what the designed levels are for.

Seeded is classic rules dealt from a number, which the 32blit version had: the board and
every colour dealt after it come from one seed, so two players holding the same code play
the same dots and the only thing between them is the score. A code is six dots, written as
six digits 1 to 5 the same way a level's layout is - 15,625 boards, entered by pressing the
dots round the colours or by typing the digits, and shared as a link. The board of the day is
counted in whole UTC days, so everyone quoting today's code means the same one, and the best
score is remembered per code.

## Sound

Linking and popping walk up a scale, so the scale is most of the character of a mode:
the same board sounds patient in hirajoshi and impatient in blues. A mode names a root
and a scale, or asks for a random one and gets a different voice every session, which is
what Endless does. Puzzle plays in slendro, which is a gamelan tuning and not an
equal-tempered one.

The menus have their own tuning, a note per item, so a page can be walked by ear. With
spoken menus on they read themselves out as well, and the cursor's own tone carries how
many dots it could reach from where it is.

## Elsewhere in here

[strategy-guide.html](https://gadgetoid.github.io/dots/strategy-guide.html) is a guide to
playing well: what a chain pays, what the sounds tell you, the traps, and an animated
solution to every level behind a spoiler.

[DEVELOPMENT.md](DEVELOPMENT.md) is how it is put together, and
[docs/puzzle-analysis.md](docs/puzzle-analysis.md) is the puzzle problem space in full.

## On AI

Like [GEOMETRY II](https://github.com/gadgetoid/geometry) before it, this was built
with heavy assistance from, and detailed direction of, Claude Code. The 32blit game
and the RaphaelJS one before it are mine; this is them again, with the graphics I
wanted at the time and did not have the CPU or the patience for.
