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

A chain of _n_ dots is worth **n⁴**, multiplied by the multiplier standing when it is spent.

```
chain of 2 ->    16      chain of 5 ->   625
chain of 3 ->    81      chain of 6 ->  1296
chain of 4 ->   256      chain of 7 ->  2401
```

The multiplier starts at 1 and, after each chain:

- a chain of **4 or more** raises it by one, up to a ceiling of **9**
- a chain of **3 or fewer** resets it to **1**

So the order chains are taken in matters twice: it decides which chains are available later, and it
decides what each one is worth. Two orders that clear the same board can pay wildly different
scores - on level 7 of the shipped set, anywhere between 306 and 33,077.

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
enormous on its own: **a 24-cell block of one colour has 149,613 of them** - for one position, and
every one of them wanting a board built and keyed.

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

Precisely: two chains have the same outcome exactly when, for every maximal same-colour run of a
column, they remove the same _number_ of cells from it. Which cell of a run goes is what nothing
can tell apart, because what is left of the run is the same length in the same place either way.

`outcomesFrom` keeps one chain per (resulting board, length) and the search walks those. Measured:

| Board                              | Chains  | Outcomes |
| ---------------------------------- | ------- | -------- |
| Three rows of one colour           | 3000+   | 1181     |
| A 24-cell block, uncapped          | 149,613 | 7214     |
| The busiest position of the twenty | 151     | 98       |

### 3. Independent parts: what does and does not decompose

Five full columns in five colours is not one puzzle but five. Each column has 8 states, so the board
has 8⁵ = 32,768 - and adding a sixth column costs **eight times** as much rather than a little more.
That was the symptom that gave it away: 0.9s for four columns, 8s for five, 20s and still inexact for
six.

**Clearability decomposes.** Columns sharing no colour can never affect each other - a chain needs
one colour and gravity works down a column - so the whole board is clearable exactly when every part
is, and each part's positions are a tiny fraction of the product. That is `partsClearable`, and it is
what answers a board the whole-board walk cannot finish.

**Par does not decompose, and an earlier version of this that said it did was wrong.** The reasoning
that failed: each part yields the multisets of chain lengths it can be cleared with, merge one from
each part, and value the merged multiset over every order it could be played in. Interleaving
_across_ parts really is free. But that treats a part's chains as freely reorderable _within_ the
part, and they are not - a multiset comes from one particular clearing order, and the collapse
decides which orders exist at all.

It was caught by the check described below, on a level added while it was in place: the merge claimed
2577, from one part cleared with chains of 5, 6, 7 and another with 6, interleaved ascending. No real
order beats 2450, because that part cannot play 5, 6, 7 in that order. The level shipped with a par
of 2577 for exactly as long as it took the check to run.

Doing it properly would mean tracking each part's achievable **sequences** rather than multisets, and
interleaving those - whose state is how far along each part has got, which is the product of the
parts' positions, which is the whole-board walk. So there is nothing to be saved here for par.

What was lost by removing it is small, because the other work carries those boards anyway:

| Columns of distinct colours | With the unsound merge | Walked, correct |
| --------------------------- | ---------------------- | --------------- |
| 5                           | 3.4s                   | 1.7s            |
| 6                           | 6.1s                   | 15.6s           |

Six of the thirty shipped levels decompose. Their pars were all correct anyway - the merge happened
to pick achievable orders for them - which is precisely why a construction needs a witness rather
than a spot check. The editor still reports the decomposition, since a level that is several
unrelated puzzles side by side is worth telling its author about, and they measure easier for it:
mean difficulty 6.44 against 8.76 for the rest.

### 4. How a position is held

**One word per column, four bits per cell, packed up from the floor.** A colour is stored as its
code plus one, so nought means nothing there and a column's word is exactly as long as the dots
standing in it. Two things follow:

- **Collapsing stops being an operation.** A column that has had a dot taken out of it is the bits
  above the gap shifted down over it, and only the columns a chain actually touched are rebuilt.
- **A position keys as two characters a column** - twelve for this board, against forty-two for a
  cell each. One key is built per position and per move, so it is the most-run line here.

Worth **1.40x** end to end: the twenty-level report takes 8.3s against 11.7s a cell at a time,
with every number it prints unchanged.

Four bits rather than three, which would also fit seven rows. Both need two characters a column -
21 bits and 28 bits round up the same - so the shorter field buys nothing unless columns are
packed _across_ the character boundary, eight characters against twelve. That costs a shifting
loop, and measures slower than the wider field it saves: 71ms against 53ms per 400,000 keys. Four
bits also holds every digit a layout may use, where three stops at seven colours.

Neighbours are what a chain is made of, and the packing knows only about columns, so `movesFrom`
spreads a position back out into a flat grid - once per position, however many chains come off it.
That is the only place it happens, apart from the picker's preview.

### Measured and rejected

**Mirroring.** A board mirrored left to right is the same game - every rule is left-right
symmetric and gravity is untouched by the mirror - so positions could be keyed on whichever way
round reads smaller. Worth 37% on a field of one colour, **0.6% across the twenty shipped
levels**, and it costs a second key everywhere. Not kept.

**Deduping on the run signature.** Since an outcome is exactly a count of cells taken from each
same-colour run, that count could be the key instead of the collapsed board. It is a correct key
and a slower one: building it costs more than the collapse and the key it saves.

**Caching the outcome list on the board.** A position is valued once per multiplier standing on
it, and each of those rebuilds the same list of outcomes. Holding the list against the board alone
halves the enumerations - and is worth 1.16x, because the lists are large and keeping them all
costs more than rebuilding them. Not kept.

And nothing else is coming from symmetry. Mirroring and relabelling the colours are the only two
transformations that commute with the rules - gravity rules out the vertical and rotational ones -
and relabelling cannot help inside one board's search, since a game tree keeps its colours. Across
the boards the level hunt draws it is worth 0.4%: the space is much too big for two draws to be
relabellings of each other.

Nor from a better algorithm. This is Clickomania with a path constraint on chains, and Clickomania
is NP-complete with as few as two columns and five colours (Biedl, Demaine, Demaine, Fleischer,
Jacobsen and Munro, 2002); requiring a chain to be traceable makes listing the moves a
Hamiltonian-path question on a grid subgraph, NP-complete in general (Itai, Papadimitriou and
Szwarcfiter, 1982) and polynomial only for solid ones (Umans and Lenhart, 1997). Walking the graph
and valuing each position once is the right shape, and the only lever on it is how wide the graph
is - which is what the decomposition and the outcome quotient are for.

## Checking the claim by playing it

par is worked out, and anything worked out can be worked out wrongly. So the level test does not take
it on trust: `parRoute` finds an order that scores par by walking the whole board, and the test plays
that order through the real game and asserts the score comes out at par.

That is three independent things agreeing - the analysis, a separate walk, and the game itself - and
it is the check that caught the unsound decomposition above. Two properties earn their keep:

- **It is deliberately not the same code.** A cross-check that shares machinery with the thing it
  checks is not a check.
- **It reports nothing rather than something smaller.** An earlier version counted calls instead of
  positions, ran out of budget on a board that fits easily, and returned the best route it had found
  so far - which read as "par is wrong" on a level whose par was right. A degraded answer that looks
  like an answer is worse than no answer.

## When the answer is not exact

A search that ran out of time, or out of moves it could list, has proved nothing. So `clearable` is
three-valued, and this matters: a truncated move list might have omitted the very move that clears
the board, so "cannot be cleared" would be a lie.

`exact` says whether par and floor are the real numbers or bounds, and `statsExact` says the same of
everything else - how many orders pay par, how long one is, which openings are traps, and so the
difficulty. The two coincide now that par comes from the whole-board walk in every case; they were
added when it did not, and are kept apart because that is the honest shape of the answer.

The editor uses both:

- `solve()` first, because finding **one** clearing order proves clearable and stops at the first,
  where par has to value every position there is.
- par shown as "at least" where the walk could not finish, and the counts not shown at all where
  `statsExact` is false.
- no layout offered for pasting unless the answer is exact, since the level test recomputes both
  numbers and would disagree.

The level hunt gates on `statsExact` too. Without it a run fills up with boards that measured hard
only because their walk stopped early: every position it never reached counts as a trap.

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

The shipped levels are two sets of fifty-two, the first running 2.03 to 14.25 and the second 2.03 to
13.84, and the level test asks the same of each: the order, that only the first two are forced, and
that the back half has one best order which greed does not find. It also asks that no board is in
both sets, folding out mirrors and colour renamings, since either would be the same puzzle twice.

The second set exists because the first cannot be extended downwards. A keep in the search needs
greed to miss par, which is 1.5 of the difficulty score on its own, so nothing a run keeps measures
under about 5: the gentle end of a ladder has to be drawn and measured rather than climbed.

**The size term is a property of the search, not of the board**, which is worth being explicit
about because it has two consequences. A candidate cannot be scored without being walked in full;
and anything optimising difficulty is rewarded for finding boards that are expensive to search,
which is what the level hunt has to be built around.

It could be otherwise. Across the twenty, the dot count alone predicts the positions searched at
_r_ = 0.972 - `log10(states) ≈ 0.2122 × dots - 0.1188` - and substituting the fit moves no level
by more than 0.35. But the twenty are monotone by margins smaller than that, so the substitution
inverts three neighbouring pairs and moves four band edges. The ladder is what the term is
calibrated against, so the term stays.

## Searching for levels

Silhouettes are drawn by hand, because a shape is the part a player looks at and no search knows
what looks good. The colours are searched, because none of the qualities above can be seen in a
layout.

**The space is not enumerable.** With five colours and ignoring which colour is which, a
silhouette of _n_ dots has 5ⁿ/120 colourings. A board of this size is judged in one to three
seconds; the last column is generously rounded down to a millisecond, which is a thousand times
faster than it is:

| Silhouette | Dots | Colourings | At 1000 judged/second |
| ---------- | ---- | ---------- | --------------------- |
| bullseye   | 18   | 3.2e10     | 1 year                |
| comb       | 24   | 5.0e14     | 16,000 years          |
| mesa       | 30   | 7.8e18     | 2.5e8 years           |
| keep       | 32   | 1.9e20     | 6.1e9 years           |

So the boards it does draw are a **structured subset**: colours grown as connected regions rather
than scattered. That is both a far better prior - 98% of those can be cleared against 8.5% of
scattered ones, measured over 2,406 and 1,648 of them - and closer to what a person would draw,
since it comes out as areas of colour rather than confetti.

That prior is so good that it leaves the search with nothing cheap to reject on. Of 4,000 drawn,
**none** is thrown out for having a colour with one dot in it, and one clearing order throws out
**2%**. Everything else reaches the full walk, which is the whole cost of a run.

### Drawing at random does not work

Two matched eight-minute runs, same leash and same test for a keep:

|                           | Judged | Too big to judge | Kept at 11.5 or more | Best  |
| ------------------------- | ------ | ---------------- | -------------------- | ----- |
| Random boards             | 147    | 47               | **0**                | -     |
| Climbing, one cell a step | 184    | 21               | **26**               | 12.54 |

12.54 is above the 11.48 the shipped ladder tops out at.

So a number is not a board but a **starting point**, and the search walks uphill from it:
recolour one dot to a colour already beside it, judge, keep the change unless it measured easier,
and start somewhere else after `--steps` without an improvement.

The two things that make the climb work are both about its own cost. Difficulty counts the
positions searched, so a board that is expensive to judge scores well by being expensive - and an
unrestrained climb heads straight for boards that cannot be judged at all. A first attempt that
recoloured a whole region at a time managed 35 judgements in eight minutes and kept nothing. So:

- **One dot at a time**, never leaving a colour with a single dot and never growing a
  single-colour region past ten. One dot because a region at a time merges regions; a neighbour's
  colour because it keeps the board reading as areas, which is the prior the drawing is built on.
- **A board that ran out of leash scores nothing**, rather than scoring what the unfinished walk
  came to. An unfinished walk reads as harder than the board is: every position it never reached
  counts as a trap.

What makes a long run worth leaving on:

- **Deterministic.** A starting point and the whole climb from it are a pure function of the
  number, so no two workers do the same work, `--from` carries on where the last run stopped, and
  `--show N` reproduces a starting point.
- **Written as found.** `--out` is a directory: a file per find named for how hard it measured,
  plus a summary rewritten each time, both safe to read while it runs.
- **One find per family.** A climb's next find is its last find with a dot moved, so a find is
  only kept if it differs from every find already kept by `--apart` cells.

## Known limits

- A region of one colour past about 20 cells cannot be enumerated, so boards built from them get
  bounds rather than answers. They are also bad levels, so this has not been worth fixing.
- `parPaths` counts distinct **plays**, not distinct drawings of the same play. That is the more
  meaningful count, but it is not the number a player would arrive at by counting lines on paper.
- Difficulty is a model, calibrated against the original seven levels. It orders the ladder
  sensibly; it is not a claim about how long a person will take.
- The decomposition only splits on **columns**. Two halves of a board that share a colour but can
  never actually reach each other are not detected.
