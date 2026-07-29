# Judging a puzzle board

What can be known about a designed board without playing it, why each answer is exactly
computable, what it costs, and what the search does about the cost. This is the reasoning behind
`src/solver.js`, `src/analysis.js`, `tools/find-levels.mjs` and the editor.

## The rules that bound the problem

Puzzle mode is the game with the refill turned off, which is what makes a board a puzzle rather
than a sequence of them.

| Rule                     | What it means for the search                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| A chain is one colour    | Moves are confined to single-coloured regions                                                           |
| Cardinal neighbours only | No diagonals; a region is 4-connected                                                                   |
| A chain is a simple path | It must be **traceable** without revisiting a dot, so a connected set is not automatically a legal move |
| At least `minChain` dots | Two, for puzzle mode                                                                                    |
| Nothing refills          | The board only ever shrinks                                                                             |
| Gravity is per column    | A pop is followed by each column falling; columns never feed each other                                 |
| The board is 6 x 7       | 42 cells, five colours available                                                                        |

Two consequences do most of the work later:

- **The position graph is a directed acyclic graph.** A pop only removes dots, so no position is
  ever reachable from itself. Every question below is therefore a finite walk with no risk of
  cycling, and each position need be valued only once.
- **Columns that share no colour can never interact.** A chain needs one colour and gravity works
  down a column, so two columns with no colour in common are separate puzzles that happen to be
  drawn side by side.

## How a board is scored

A chain of _n_ dots is worth **n³**, multiplied by the multiplier standing when it is spent.

```
chain of 2 ->     8      chain of 5 ->   125
chain of 3 ->    27      chain of 6 ->   216
chain of 4 ->    64      chain of 7 ->   343
```

The multiplier starts at 1 and, after each chain:

- a chain of **4 or more** raises it by one, up to a ceiling of **9**
- a chain of **3 or fewer** resets it to **1**

So the order chains are taken in matters twice: it decides which chains are available later, and it
decides what each one is worth. Two orders that clear the same board can pay wildly different
scores - on level 7 of the shipped set, anywhere between 126 and 3717.

The rules live in `src/config.js` as `chainScore`, `MULTIPLIER_CHAIN` and `MULTIPLIER_MAX`, and are
passed **into** the analysis rather than restated in it, so the two cannot drift.

## What is worth knowing about a board

| Answer        | Meaning                                            | Used for                                               |
| ------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `clearable`   | true, false, or **null** for not established       | A board that cannot be emptied is not a level          |
| `par`         | The most any clearing order pays                   | The target shown while playing; a star for reaching it |
| `floor`       | The least any clearing order pays                  | Whether how you play matters at all                    |
| `parPaths`    | How many distinct orders pay par                   | Whether there is a single best solution to find        |
| `firstMoves`  | Openings available                                 | Branching at the point of least information            |
| `firstSilent` | Openings that lose the level **without saying so** | Most of what makes a board hard                        |
| `greedy`      | What taking the longest chain every time does      | Whether the obvious play is right                      |
| `difficulty`  | 1 to 5 as a band, plus a raw number                | Ordering the ladder                                    |
| `decomposed`  | How many independent puzzles the board really is   | A design warning                                       |

`floor == par` is the useful degenerate case: every clearing order pays the same, so there is
nothing to aim at and no star is offered. The first two shipped levels are deliberately like that.

## Why the answers are exact

Because the graph is acyclic, one walk answers all of them. `analyse` values each position once,
memoised on the board **and the multiplier** - the same board is worth more with a multiplier
banked, so the two together are the state.

```
value(position, multiplier) =
  0                                   if the board is empty
  max over legal moves of             otherwise
      score(length) * multiplier + value(child, multiplierAfter(multiplier, length))
```

The same walk taking `min` instead of `max` gives the floor, counting ties gives `parPaths`, and a
move whose child cannot be cleared is a trap.

## What it costs, and what to do about it

Four separate costs, each of which has bitten:

### 1. Enumerating moves: paths versus sets

A chain is a path, so the obvious enumeration walks paths. But the same set of cells is reached by
many orders, and only the set matters. Worse, the count of legal chains through a large region is
enormous on its own: **a 24-cell block of one colour has 149,613 of them**, taking 3.4 seconds to
list - for one position.

Three things bound it, in `movesFrom`:

- **Memoise the walk on (where it is now, what it has taken).** What can be reached from there
  depends on those two and nothing else, so a state reached again by another order has nothing left
  to discover. The mask is over one region's cells, so it fits in an integer.
- **Cap the list** at `MOVE_LIMIT` (3000) and tell the caller it was cut short. The shipped levels
  peak in the hundreds; a board that needs more is not a level anyone would play.
- **For a region past 30 cells**, offer a handful of long greedy paths instead of nothing, so a
  board of one colour still looks like what it is - the easiest board there is.

### 2. The same play counted many times: outcomes, not chains

This is the big one. **Nothing downstream can tell two chains apart if they are the same length and
leave the same board**: the score is a function of the length, so is the multiplier, and the future
is a function of the board. So a snake through a field has four ways round that are all one play,
and taking five cells from a column leaves the same board wherever along it they were taken.

`outcomesFrom` keeps one chain per (resulting board, length) and the search walks those. Measured:

| Board                    | Chains | Outcomes |
| ------------------------ | ------ | -------- |
| A reported 24-dot board  | 274    | 124      |
| Three rows of one colour | 3000+  | 1181     |

### 3. Independent parts: a product that need not be walked

Five full columns in five colours is not one puzzle but five. Each column has 8 states, so the
board has 8⁵ = 32,768 - and adding a sixth column costs **eight times** as much rather than a
little more. That was the symptom that gave this away: 0.9s for four columns, 8s for five, 20s and
still inexact for six.

The parts are judged separately. The one thing that joins them is the multiplier, which is global
and runs in the order chains are actually played, so the parts cannot simply be added. Instead:

1. Each part yields the **multisets of chain lengths** it can be cleared with.
2. Merge one multiset from each part.
3. Value the merged multiset over every order it could be played in - a small search over how many
   of each length remain, with nothing to do with where the dots were.

Step 3 is a DP over (remaining counts, multiplier) so it holds whatever the multiplier rule is. The
intuition, for the rule as it stands: chains under 4 reset the multiplier so they belong first, and
chains of 4 or more should run in ascending order, since swapping an adjacent pair _a ≤ b_ changes
the total by _b³ - a³ ≥ 0_.

| Columns of distinct colours | Before           | After       |
| --------------------------- | ---------------- | ----------- |
| 4                           | 0.9s             | 0.33s       |
| 5                           | 8s, inexact      | 3.4s, exact |
| 6                           | 20s, lower bound | 6.1s, exact |

Six of the twenty shipped levels decompose, and their par and floor are unchanged by this - which
is the check that matters. The editor reports the decomposition too, since a level that is several
unrelated puzzles side by side is worth telling its author about.

### 4. Housekeeping

The memo key is one character per cell (`String.fromCharCode`), which is three times faster to
build than joining numbers with separators: 139ms against 404ms per 400,000 keys, and one is built
per position and per move.

### Measured and rejected

A board mirrored left to right is the same game - every rule is left-right symmetric and gravity is
untouched by the mirror - so positions could be keyed on whichever way round reads smaller. Worth
46% on a field of one colour, **0.6% across the twenty shipped levels**, and it costs a second key
everywhere. Not kept.

## When the answer is not exact

A search that ran out of time, or out of moves it could list, has proved nothing. So `clearable` is
three-valued, and this matters: a truncated move list might have omitted the very move that clears
the board, so "cannot be cleared" would be a lie. `exact` says whether par and floor are the real
numbers or lower and upper bounds.

The editor uses that:

- `solve()` first, because finding **one** clearing order proves clearable and stops at the first,
  where par has to value every position there is.
- par shown as "at least" where the walk could not finish.
- no layout offered for pasting unless the answer is exact, since the level test recomputes both
  numbers and would disagree.

## How difficulty is measured

Not a guess about a player, but a combination of measurable things (`DIFFICULTY` in
`src/analysis.js`):

| Term                                     | Why                                         |
| ---------------------------------------- | ------------------------------------------- |
| chains in the solution                   | More chains, more chances to go wrong       |
| log of positions searched                | How much a player has to hold in their head |
| share of openings that lose **silently** | The heart of it; see below                  |
| share that lose **visibly**              | Counted at a fraction of the weight         |
| the obvious play strands the board       | The largest single penalty                  |
| the obvious play misses par              | A smaller one                               |
| exactly one order pays par               | There is a single thing to find             |

Two findings shaped this:

**Trap rate on its own is misleading.** It read a nine-dot level with two of everything as harder
than the twenty-two dot lock, because almost any move on a tiny board orphans something - but the
whole board is in view and a player sees it. The size term replaced it.

**Traps come in two kinds.** A trap that leaves a colour with a **single dot** on the board proves
the level lost and is as visible to a player as to the solver: nothing refills, so that dot can
never be matched. Nobody plays into that twice. A trap that leaves everything still looking
matchable is a different thing entirely, and it is what makes a level hard.

Every trap in the original seven levels is the visible kind - which is exactly why they play as
forgiving even though 56-92% of their moves strand the board. Traps that do not announce themselves
come out of the collapse several moves deep, and that is why the later levels were searched for
rather than authored by eye.

The shipped twenty run from 2.03 to 11.48 and the level test asserts the order, that only the first
two are forced, and that the back half has one best order which greed does not find.

## Searching for levels

Silhouettes are drawn by hand, because a shape is the part a player looks at and no search knows
what looks good. The colours are searched, because none of the qualities above can be seen in a
layout.

**The space is not enumerable.** With five colours and ignoring which colour is which:

| Silhouette | Dots | Colourings | At 250 judged/second |
| ---------- | ---- | ---------- | -------------------- |
| bullseye   | 18   | 3.2e10     | 4 years              |
| comb       | 24   | 5.0e14     | 63,000 years         |
| mesa       | 30   | 7.8e18     | 1.0e9 years          |
| keep       | 32   | 1.9e20     | 2.5e10 years         |

So the search walks a **structured subset**: colours grown as connected regions rather than
scattered. That is both a far better prior - one in three of those boards can be cleared, against
one in twenty of scattered ones - and closer to what a person would draw, since it comes out as
areas of colour rather than confetti.

What makes a long run worth leaving on:

- **Deterministic.** A candidate is a pure function of its number, so nothing is tried twice,
  workers interleave by number, and `--from` carries on where the last run stopped. `--show N`
  reproduces any candidate.
- **Cheap rejections first**, in order of cost: a colour with one dot (free), then one clearing
  order, then greed. Proving a board cannot be cleared means exhausting its graph - the slowest
  case and the commonest - so it is never the first question asked.
- **Written as found.** `--out` is a directory: a file per find named for how hard it measured, plus
  a summary rewritten each time, both safe to read while it runs.

Roughly one candidate in 300 measures past 11.5.

## Known limits

- A region of one colour past about 20 cells cannot be enumerated, so boards built from them get
  bounds rather than answers. They are also bad levels, so this has not been worth fixing.
- `parPaths` counts distinct **plays**, not distinct drawings of the same play. That is the more
  meaningful count, but it is not the number a player would arrive at by counting lines on paper.
- Difficulty is a model, calibrated against the original seven levels. It orders the ladder
  sensibly; it is not a claim about how long a person will take.
- The decomposition only splits on **columns**. Two halves of a board that share a colour but can
  never actually reach each other are not detected.
