Below is a coding-agent-ready spec. I’ve treated your remembered rules as the canonical ruleset, rather than trying to “correct” them toward Contract Bridge. I’ve also marked the few deliberate assumptions so the agent doesn’t silently invent rules.

Singaporean Floating Bridge — Game Specification

1. Project Goal

Build a browser-based implementation of the Singaporean/Floating Bridge variant described below.

The application should be suitable for hosting as a static site on GitHub Pages.

Primary goals:

1. Teach a new player how this variant works.
2. Allow a user to play complete hands against computer players.
3. Make the unusual blind-partnership / called-card mechanic clear.
4. Keep the rules distinct from Contract Bridge.
5. Do not introduce Contract Bridge rules merely because they are familiar.

The implementation should use the rules in this document as authoritative.

Local variants of Singaporean Bridge exist. This project should therefore describe itself as implementing one Singaporean/Floating Bridge ruleset, rather than claiming to be the universally canonical rules.

---

2. Player Model

Exactly four players:

- South — human player
- West — computer
- North — computer
- East — computer

No 2-player, 3-player, or 5-player modes are required.

Players sit around a table in fixed clockwise order:

"South → West → North → East → South"

There are two partnerships per hand:

- Declarer + called partner
- The other two players

Partnerships do not exist during the auction.

---

3. Cards

Use one standard 52-card deck.

Ranks, from highest to lowest:

"A K Q J 10 9 8 7 6 5 4 3 2"

Suits:

- Spades
- Hearts
- Clubs
- Diamonds

For bidding purposes, suit order is:

"Spades > Hearts > Clubs > Diamonds"

This suit ordering is used only for comparing bids.

No Jokers.

---

4. Deal

Each player receives exactly 13 cards.

Cards are dealt one at a time around the table.

The resulting hands are private:

- Human sees their own hand.
- Computer hands remain hidden.
- Players do not see any opponent's cards.
- Players do not see their eventual partner's hand before or during the auction.

The entire deck is dealt before bidding begins.

---

5. Auction

5.1 Bid format

A bid consists of:

"<trick target> <trump suit>"

Examples:

- "5 Diamonds"
- "5 Hearts"
- "6 Hearts"
- "6 Spades"
- "7 Spades"

The number represents the minimum number of tricks the eventual partnership must win.

Example:

"7 Hearts"

means:

«The declarer's partnership must win at least 7 of the 13 tricks, with Hearts as trump.»

It does NOT mean "7 tricks above six" as in Contract Bridge.

---

5.2 Legal bid range

Minimum bid:

"1"

Maximum bid:

"13"

However, the first player is expected to make an opening bid; see passing rules below.

A bid at target 13 means the partnership must win all 13 tricks.

---

5.3 Bid comparison

A bid is higher if:

1. Its trick target is higher, OR
2. Its trick target is equal and its suit is higher according to:

"Spades > Hearts > Clubs > Diamonds"

Therefore:

"5 Hearts < 5 Spades"

"5 Clubs < 5 Hearts"

"5 Spades < 6 Diamonds"

"6 Diamonds < 6 Clubs"

The auction is therefore lexicographically ordered by:

"trick target → suit rank"

Do NOT use Contract Bridge's suit ordering.

---

5.4 Passing

Players may pass after a valid opening bid has been made.

The first player may NOT pass.

Therefore:

- Player 1 must make a legal opening bid.
- Players 2–4 may bid or pass.
- If everyone after the opening bid passes, the opening bidder wins.

If a player has already passed, they are out of the auction and may not bid again.

The auction continues until only one active bidder remains.

---

5.5 Winning the auction

The highest remaining bid determines:

- Declarer
- Trick target
- Trump suit

Example:

South: "5 Hearts"
West: "5 Spades"
North: "6 Clubs"
East: pass
South: "6 Hearts"
West: pass
North: pass

South wins.

Final contract:

"6 Hearts"

South is declarer and must win at least 6 tricks.

---

6. Partner Calling

Immediately after the auction, the declarer selects one specific card as the called card.

Rules:

1. The called card must NOT be in declarer's own hand.
2. The called card may be any rank and suit.
3. The card must exist in the deck, obviously.
4. The called card identifies declarer's partner.
5. The player holding the called card becomes declarer's partner.

Example:

South wins the auction with "7 Hearts".

South does not hold the Ace of Hearts.

South calls:

"Ace of Hearts"

The player holding Ace of Hearts becomes South's partner.

The remaining two players become the opposing partnership.

---

7. Partner Revelation

Canonical implementation for this project

The partner's identity is publicly revealed immediately after the card is called.

The UI should display something equivalent to:

«South called A♥.
East holds A♥ and is South's partner.»

This is the simplest version for teaching and is the remembered version of the game.

Optional future variant

The code architecture should make it possible to support a "hidden partner" variant later, where the called-card holder knows they are partner but the other players do not.

This is NOT required for the initial implementation.

---

8. Declarer's Calling Strategy

The rules do not prescribe how the declarer chooses the card.

However, a common practical heuristic is:

«Call the highest card in the chosen trump suit that the declarer does not hold.»

Example:

Declarer's hand contains:

"A♥ 10♥ 7♥ 3♥"

Trump is Hearts.

The declarer could call:

"K♥"

if they do not hold it.

This is a strategy hint for the teaching material and potentially for the computer AI.

It is NOT a rule.

The declarer is allowed to call a low card, off-suit card, etc.

---

9. First Trick

After the partner has been determined, normal trick play begins.

The player to the declarer's left leads the first trick.

Seating example:

South = declarer

West = declarer's left

Therefore West leads.

This is the default rule for this implementation.

Do not have declarer automatically lead.

---

10. Trick Rules

Normal four-player trick-taking rules.

For each trick:

1. The leader plays any legal card.
2. Each subsequent player must follow the led suit if they have a card of that suit.
3. If they do not have the led suit, they may play any card, including trump.
4. The highest trump wins if any trump was played.
5. Otherwise, the highest card of the led suit wins.
6. The winner of the trick leads the next trick.

Card ranking:

"A > K > Q > J > 10 > 9 > ... > 2"

There is no special low-card or high-card rule.

---

11. Number of Tricks

There are exactly 13 tricks.

Each player starts with 13 cards.

One card is played by each player per trick.

After trick 13, all cards have been played.

Track tricks won by each partnership.

---

12. Hand Result

The declarer's partnership either succeeds or fails.

Example:

Contract:

"7 Hearts"

Declarer's partnership wins:

- 7 tricks → SUCCESS
- 8 tricks → SUCCESS
- 9 tricks → SUCCESS
- ...
- 13 tricks → SUCCESS
- 6 tricks or fewer → FAILURE

There is no distinction between 7 and 10 successful tricks for basic scoring.

---

13. Scoring

The basic game uses a deliberately simple result system.

No Contract Bridge scoring system.

No duplicate-bridge scoring.

No vulnerability.

No doubled contracts.

No redoubles.

No overtrick points.

No undertrick penalty calculations.

For the initial implementation, each hand produces one binary result:

- Declarer partnership wins
- Declarer partnership loses

The UI may display:

«Contract made — 8 / 7 tricks»

or:

«Contract failed — 6 / 7 tricks»

The game may track hand wins across multiple hands if a match mode is implemented, but no elaborate scoring system is required.

---

14. No-Trump

No-trump is NOT valid.

Every contract must specify one of:

- Spades
- Hearts
- Clubs
- Diamonds

Do not implement NT bidding.

---

15. Doubling

Not part of the basic ruleset.

Do not implement:

- Double
- Redouble

---

16. Game / Match Structure

Initial version should support playing one complete hand.

Recommended future structure:

"Deal → Auction → Partner Call → 13 Tricks → Result → Next Hand"

If multiple hands are implemented, dealer rotates clockwise.

Suggested order:

South → West → North → East → South

The initial MVP does not require a race-to-X score or traditional Bridge match scoring.

---

17. Information Visibility

This is a critical gameplay requirement.

Human player

The human may see:

- Their own 13 cards
- All public bids
- Current highest bid
- Whose turn it is to bid
- Final contract
- Called card
- Partner identity
- Cards played in previous tricks
- Current trick
- Number of tricks won by each partnership

Human must NOT see:

- Any opponent's unplayed cards
- Any computer's full hand
- Hidden information that would not be available at a real table

After a card is played, naturally, that card becomes public information.

The UI should therefore maintain a distinction between:

"known cards"

and

"unknown cards".

---

18. Public Information

The following are public:

- All bids
- Who passed
- Final contract
- Declarer
- Called card
- Partner identity
- Every card played
- Winner of every completed trick
- Current trick count

The following are private:

- Unplayed cards in every hand except the human's own hand

---

19. Game State

The game engine should maintain at least:

Game
├── deck
├── players[4]
├── hands[4]
├── dealer
├── auction
│   ├── bids
│   ├── currentBid
│   ├── activePlayers
│   └── declarer
├── contract
│   ├── tricksRequired
│   └── trumpSuit
├── calledCard
├── partnerships
│   ├── declarer
│   ├── partner
│   └── defenders
├── tricks
│   ├── completedTricks
│   └── currentTrick
└── result
    ├── tricksWonByDeclarer
    └── contractMade

Use explicit game phases rather than relying on UI state.

Recommended phases:

DEALING
AUCTION
PARTNER_CALL
TRICK_PLAY
HAND_RESULT

---

20. Important Invariants

The engine should enforce these rather than trusting the UI.

Cards

- Exactly 52 cards exist.
- Every card exists exactly once.
- Every player starts with exactly 13 cards.
- No card can be played twice.
- A player can only play a card currently in their hand.

Auction

- First player cannot pass.
- A bid must be strictly higher than the current bid.
- Passed players cannot bid again.
- Auction ends when only one active bidder remains.
- Final bid determines declarer and trump.

Partner

- Called card cannot be in declarer's hand.
- Exactly one player owns the called card.
- That player becomes partner.
- Declarer + partner form one partnership.
- Remaining two players form the other.

Trick play

- Exactly four cards per trick.
- Players must follow suit when able.
- Exactly 13 tricks occur.
- Trick winner leads next trick.
- Every card is played exactly once by the end of the hand.

---

21. Computer Players

The initial AI does not need to be expert Bridge AI.

It should be competent enough to teach the game.

AI needs three decision types:

1. Auction bid/pass
2. Partner call when AI is declarer
3. Card to play during a trick

The AI should obey all rules.

Suggested AI progression

MVP:

- Legal-move-only random AI

Then improve:

- Basic hand evaluation
- Trump counting
- High-card strength
- Suit length
- Expected trick count
- Partner-call heuristic
- Basic trick-taking strategy
- Card-counting from public play

Do not over-engineer AI before the game engine is stable.

---

22. Teaching Mode

Teaching is a primary purpose of the project.

The site should explain the game in this order:

Step 1 — Deal

Everyone receives 13 private cards.

Step 2 — Bid

Players compete to name the number of tricks they believe their eventual partnership can win.

The strange part:

«You don't know who your partner is yet.»

Step 3 — Choose trump

The suit in the winning bid becomes trump.

Step 4 — Call a card

The declarer chooses a card they do not hold.

Whoever has that card becomes their partner.

Step 5 — Play

The player to declarer's left leads.

Play proceeds as normal trick-taking.

Step 6 — Check the contract

If the declarer's partnership wins at least the contracted number of tricks, the contract succeeds.

---

23. Tutorial Example

The tutorial should include a worked example.

Example:

«South bids 5♥.

West bids 5♠.

North bids 6♣.

East passes.

South bids 6♥.

West passes.

North passes.

South wins the auction with 6♥.

South does not hold K♥, so South calls K♥.

North holds K♥.

North therefore becomes South's partner.

West and East are the defenders.

West leads the first trick.

Hearts are trump.

South + North must win at least 6 tricks.»

The tutorial should explicitly emphasize:

«North was NOT South's partner during the auction.»

---

24. UI Requirements

The table should visually communicate the four seats:

                 NORTH
              [computer]

WEST [computer]      [computer] EAST


                 SOUTH
                  YOU

The human's cards should be displayed prominently at the bottom.

Computer cards should be represented by card backs / hidden cards.

During bidding:

- Show all previous bids.
- Clearly indicate whose turn it is.
- Disable illegal bids.
- Make legal bids easy to understand.

During partner calling:

- Display the human's hand.
- Prevent selection of cards in the human's hand.
- Clearly state that the selected card determines the partner.
- Explain the consequence before confirmation.

During trick play:

- Show played cards in the center.
- Highlight legal cards in the human hand.
- Show trump suit.
- Show contract.
- Show tricks won by each partnership.

---

25. UX Priority

The unusual mechanic must never be ambiguous.

At the beginning of the auction, show:

«You don't have a partner yet.»

After winning:

«You won the auction. Now choose one card you don't hold. Whoever has it will become your partner.»

After calling:

«Your partner is North.»

Then:

«Hearts are trump. You need 7 tricks. West leads.»

The game should never make the player infer these relationships from the UI.

---

26. Rules That Are Deliberately NOT Implemented

Do not import rules from Contract Bridge unless explicitly added later.

Not implemented:

- Fixed partnerships
- Dummy
- No-trump
- Double
- Redouble
- Vulnerability
- Contract Bridge scoring
- Contract Bridge's 1-level / 2-level terminology
- Contract Bridge suit ordering
- Declarer automatically leading
- Global Bridge match-point scoring
- Rubber Bridge scoring

---

27. Potential Future Variants

Design the engine so these can eventually be toggled without rewriting the core game:

Hidden Partner

After the declarer calls a card, only the card holder knows that they are partner.

Other players do not immediately know the partnership.

Alternate First Lead

Allow dealer-left or declarer lead as configurable variants.

Alternate Bid Scale

Support variants where:

"4♥ = 10 tricks"

rather than:

"4♥ = 4 tricks"

Traditional Scoring

Could later add a proper scoring system.

These should be treated as variants, not mixed into the basic rules.

---

28. Recommended Architecture

Separate the project into:

game engine
    ↓
AI
    ↓
UI

The game engine must be usable independently of the UI.

Prefer pure/state-transition functions for rules such as:

isLegalBid()
compareBids()
getLegalBids()
callPartner()
getLegalCards()
playCard()
resolveTrick()
isContractMade()

The UI should never determine whether an action is legal.

The engine should.

---

29. Testing Requirements

Unit tests should cover at minimum:

Card/deal tests

- 52 unique cards
- 13 cards/player
- no duplicates

Auction tests

- legal opening bids
- illegal first pass
- same-level suit ordering
- higher-level bid
- illegal lower bid
- passed player cannot bid
- correct auction winner

Partner tests

- cannot call card in own hand
- correct partner identified
- correct defenders identified

Trick tests

- must follow suit
- may discard when unable to follow
- trump beats led suit
- higher trump wins
- highest led suit wins when no trump
- trick winner leads next

Contract tests

- exactly target → success
- above target → success
- below target → failure
- 13 target → only 13 tricks succeeds

---

30. MVP Definition of Done

The MVP is complete when a human can:

1. Start a new hand.
2. Receive 13 cards.
3. View only their own cards.
4. Watch/participate in a four-player auction.
5. Make legal bids.
6. Win the auction.
7. Select a card they do not hold.
8. See who their partner is.
9. See the trump suit and contract.
10. Play all 13 tricks.
11. Have the engine enforce following-suit rules.
12. See the result.
13. Start another hand.

The game must be playable from beginning to end without requiring manual intervention or knowledge of Contract Bridge.

---

31. Important Design Principle

Do not silently "fix" the rules toward Contract Bridge.

This project is specifically about the Singaporean/Floating Bridge-style game where the partnership is determined after the auction.

When a rule is ambiguous, prefer:

1. This specification
2. Explicitly configured variant rules
3. A clearly documented project decision

Do not import assumptions from Contract Bridge just because the games share terminology.
