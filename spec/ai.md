# AI Specification - v1: Deduction and Legibility

Companion to `game.md`, which remains the authoritative ruleset. This spec covers only
the computer players. Where the two disagree about rules, `game.md` wins.

## Problem Statement

The computer players are stateless heuristics. They evaluate their own hand for the
auction, call the highest card they do not hold, and in play they lead their highest
card and otherwise win as cheaply as they can. They remember nothing between tricks.

Two consequences, and the first matters more:

1. **The hidden-partner mechanic is invisible.** The variant's whole interest is that
   nobody except the called card's holder knows the partnership. A human at the table
   cannot tell whether an opponent has worked out who its partner is, because the
   opponents never work anything out. A defender that ducks does so by coincidence,
   and a coincidence reads as noise, not as thought.
2. The players are weak in a specific, uninteresting way: they discard the entire
   history of the hand at every decision.

There is also a latent correctness hazard. The AI is handed the full game state,
including all four hands, and touches only its own by convention. No test enforces
this. In a hidden-information game, reading what you were not entitled to see is the
classic cheat bug, and it is invisible from the outside because a cheating player
looks merely strong.

## Solution

Give the computer players a **belief about who holds the called card**, derived only
from evidence every seat at the table can see, and **show that belief to the player**
in the same place the trick verdict already appears.

The belief is deductive, never probabilistic. A seat that fails to follow a suit
cannot hold an outstanding card in it. The declarer is never the partner. Eliminate
enough candidates and the partner is known with certainty. Every statement the belief
makes is therefore true, which is what lets it be displayed as plain language rather
than as a hedge.

This is a legibility feature first. The strength gain is real but incidental: a
defender that has deduced its ally stops trying to beat it.

Alongside it, a single difficulty dial lets a player practise against a weaker table
without the codebase carrying a second, dumber policy.

## User Stories

### 1. The AI cannot read cards it was not dealt

As a maintainer, I want the decision layer to receive a per-seat view rather than the
whole game state, so that reading an un-entitled hand is a compile error rather than a
code-review question.

**Independent test:** construct a view for a seat and drive a full hand from it. The
view type exposes exactly one hand. A test that attempts to reach another seat's cards
through the view fails to typecheck.

### 2. A seat deduces who cannot hold the called card

As a computer player, I want to eliminate seats that have shown out of the called
card's suit, so that I narrow down who my partner is from public evidence alone.

**Independent test:** a pinned deal where one defender is void in the called card's
suit. After that seat fails to follow, the belief lists it as eliminated with the
reason recorded. Ground truth confirms the seat did not hold the card.

### 3. A seat resolves the partnership when only one candidate remains

As a computer player, I want to treat the partnership as known once elimination leaves
a single candidate, so that I act on a certainty rather than waiting for the called
card to appear.

**Independent test:** a pinned deal where two of three candidates show out. The belief
resolves to the third seat, and that seat is in fact the partner.

### 4. The deduction never asserts anything false

As a maintainer, I want every claim the belief makes to be true of the actual deal, so
that the claims can be shown to the player verbatim.

**Independent test:** a property test over a large number of seeded deals. At every
decision point in every hand, each seat the belief marks as eliminated genuinely does
not hold the called card, and every resolved partnership matches the real one. Any
counterexample fails the suite and prints the seed.

### 5. The player sees the reasoning

As a player, I want to read why a computer player believes what it does, so that the
hidden-partner mechanic becomes something I can watch rather than guess at.

**Independent test:** in a deal where a seat has shown out of the called card's suit,
the rendered table shows a sentence naming that seat, the suit it showed out of, and
the conclusion drawn. In a deal where nothing has been deduced yet, no sentence
appears - the feature is silent rather than speculative.

### 6. A defender stops fighting its own partner

As a computer player, I want to play low when the current trick winner is a seat I
have deduced to be my ally, so that my side does not spend two honours on one trick.

**Independent test:** a pinned deal where a defender has resolved its ally and that
ally is winning the trick. The defender plays its lowest legal card despite holding a
card that would win.

### 7. A player can weaken the table for practice

As a player, I want a difficulty setting, so that I can practise against opponents
that make plausible mistakes rather than perfect ones.

**Independent test:** at maximum skill the chosen card is exactly the highest-scoring
legal play, deterministically, across repeated runs of a pinned position. Below
maximum, the same position yields a distribution over plays concentrated near the
best one, with the weakest setting spreading furthest.

### 8. The difficulty dial is honest

As a maintainer, I want evidence that the dial actually varies strength in the
direction it claims, so that the setting is not decorative.

**Independent test:** a seeded self-play run at each dial setting on the same set of
deals. The dialled seat's side makes its contract at a rate that is non-decreasing
across the skill ladder, with each step's difference either positive or inside two
standard errors. The run is reproducible from its seed.

## Implementation Decisions

**One policy, all four seats.** No per-seat personalities in v1. Behavioural variety
is deferred until a parameter structure exists to carry it.

**The belief admits public evidence only.** Two sources: a seat failing to follow a
led suit, and the called card being played. The declarer is excluded as a candidate
from the moment the card is called, and a seat holding the card knows immediately.
Nothing else updates the belief. In particular, no inference from *how* a seat played -
that is deferred.

**Evidence is promoted only when it becomes public.** Adapted from prior art in the
liar's dice codebases: evidence observed during a hand is not folded into a belief
until the fact is visible to every seat. This is what makes the cheat bug structurally
impossible rather than merely absent.

**Belief shape.** The deduction's output is a record of what was ruled out and why,
not a bare answer, because the reasons are what gets displayed:

```ts
type Elimination = 'is-self' | 'is-declarer' | 'showed-out' | 'card-played';

type HolderBelief = {
  candidates: PlayerIndex[];
  eliminated: { seat: PlayerIndex; reason: Elimination; suit?: Suit }[];
  resolved: PlayerIndex | null;
};
```

`resolved` is set when exactly one candidate remains, or when the called card is
played and the holder is revealed by the rules. A belief with no eliminations beyond
the trivial ones produces no player-facing sentence.

**The view is the AI's only input.** The decision layer takes a per-seat view carrying
that seat's hand, its legal plays, the public auction and trick history, the contract
and called card, the side knowledge the rules already grant that seat, and the belief.
It does not carry other hands. The existing side-knowledge rules are unchanged and
remain the authority on what a seat is entitled to know; the belief refines within
those bounds, never around them.

**Difficulty is a softmax temperature over scored legal plays.** One dial in `[0, 1]`.
Every seat computes the same scores from the same information; the dial governs only
how reliably the best-scoring play is taken. Mistakes therefore land near good plays
rather than being uniform noise, and no second policy exists to maintain.

`skill = 1.0` must select the argmax exactly. The sampled path is the default for any
unset or unrecognised value - prior art records a bug where the default resolved to
maximum skill, the sampling roll was discarded, and an entire cast silently played one
identical line. The test at story 7 exists to catch that regression specifically.

**The belief sentence is a separate function in the engine's trick-explanation
module**, rendered as a second line beneath the existing trick verdict. The existing
verdict function stays pure in the trick alone and is not modified. The belief
sentence is seat-relative: the same trick yields different sentences for different
seats, which is the point.

## Testing Decisions

**Existing seams are sufficient.** The engine is already pure with an injectable deal
function, and the end-of-hand test already drives complete hands through the AI. The
self-play harness is that driver with a seeded shuffle substituted, not new
infrastructure.

Coverage is external behaviour only:

- **Deduction correctness** as a property over seeded deals, asserting against ground
  truth rather than against expected output. This is the load-bearing test: it is what
  licenses displaying the belief as fact.
- **Pinned-deal tests** for each named elimination reason and for the duck-the-ally
  behaviour, using explicit hands rather than random deals.
- **Dial behaviour** at the extremes as a unit test on a pinned position, and
  monotonicity as a seeded self-play run.
- **The view boundary** is enforced by the type system; the test asserts a full hand
  can be driven from views alone.

The monotonicity run is slower than the rest of the suite and should be invocable
separately, not on every save.

## Out of Scope

Bidding and partner-calling behaviour are untouched in v1. The hand evaluator stays as
it is, including the cap that prevents the AI bidding above three, because the belief
work says nothing about hand evaluation and lifting the cap without improving the
evaluator would make the AI worse.

## Deferred

**Behavioural reads** - inferring from *how* a seat played, such as treating a seat
that ducked as a likely partner. Deferred because such a read can be confidently
wrong, and a wrong sentence shown as reasoning is worse than no sentence. It also
needs calibration, which needs the harness at story 8 to exist first.

**Per-seat personalities.** The intended shape is that a character's priors may remove
a play from its menu entirely but never change what the remaining plays are worth -
character without making a character miscalculate. Deferred because it needs the
parameter structure that v1's scoring function creates.

**Lead and follow policy.** The current lead rule - an ace if held, otherwise the
highest card, unconditionally - is very likely the single largest strength deficit,
larger than anything in this spec. Deferred because it is orthogonal to legibility and
large enough to deserve its own pass rather than riding along inside this one.

**Tempo and pacing.** Prior art suggests most of the felt personality in these games
comes from timing rather than from decision quality. Deferred because it is
presentation, not AI, and belongs with the table UI.

**Full strength benchmark** - a candidate policy rotated through all four seats
against a baseline, scored on contract outcome from the candidate's side. Deferred
because v1 needs only to prove the dial is monotonic, not to prove a policy is
stronger. It becomes necessary when behavioural reads arrive and need calibrating.

## Further Notes

The two prior-art codebases were surveyed before this spec. Neither ships an
AI-strength benchmark in its shipped repo; the one with extensive measurement keeps it
host-side and excluded from the build, and the browser one publishes seeds and match
logs so a hand can be replayed exactly instead. Seeded replay is the cheap half of
measurement and is worth having regardless.

The difficulty-as-temperature design and the promote-evidence-only-when-public
discipline are both taken from that prior art rather than invented here.
