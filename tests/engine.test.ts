import { describe, it, expect } from 'vitest';
import type { Card, GameState, PlayerIndex, Rank, Suit } from '../src/engine/types';
import {
  createDeck, dealCards, compareBids, getLegalBids, isHigherBid, createCard, SUITS, RANKS,
} from '../src/engine/types';
import {
  createStateFromHands, startAuction, makeBid, pass, canPass, getFirstBidder,
  callPartner, playCard, getLegalPlays, isContractMade, startNextHand,
  getSideKnowledge, isPartnershipPublic, isCalledCardPlayed, createInitialState,
} from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';
import { compareCardsInTrick } from '../src/engine/trickEvaluator';

// ---------- fixtures ----------

/** Parse "AS KH 10D ..." into cards. */
function cards(spec: string): Card[] {
  const suitOf: Record<string, Suit> = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
  return spec.trim().split(/\s+/).map(tok => ({
    rank: tok.slice(0, -1) as Rank,
    suit: suitOf[tok.slice(-1)],
  }));
}

/**
 * Deterministic deal: each player gets one whole suit, in the order given.
 * South = Spades, West = Hearts, North = Clubs, East = Diamonds by default.
 */
function suitPerPlayer(order: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds']): Card[][] {
  return order.map(suit => RANKS.map(rank => ({ suit, rank })));
}

/** Hands laid out so that South leads and every trick is decided by construction. */
function mixedHands(): Card[][] {
  // Each player holds a mix so follow-suit and discard cases both occur.
  const south = cards('AS KS QS JS 10S 9S 8S AH KH QH JH 10H 9H');
  const west = cards('7S 6S 5S 4S 3S 2S 8H 7H 6H 5H 4H 3H 2H');
  const north = cards('AC KC QC JC 10C 9C 8C AD KD QD JD 10D 9D');
  const east = cards('7C 6C 5C 4C 3C 2C 8D 7D 6D 5D 4D 3D 2D');
  return [south, west, north, east];
}

/** Auction where `declarer` bids `tricks suit` and everyone else passes. */
function auctionWonBy(state: GameState, declarer: PlayerIndex, tricks: number, suit: Suit): GameState {
  let s = startAuction(state);
  const opener = getFirstBidder(s);
  if (opener !== declarer) {
    // Opener must bid something low, then declarer overcalls, then all others pass.
    s = makeBid(s, opener, 1, 'Diamonds');
  }
  let guard = 0;
  while (s.phase === 'AUCTION' && guard++ < 8) {
    const p = s.currentPlayer!;
    if (p === declarer && !s.auction.bids.some(b => b.player === declarer)) {
      s = makeBid(s, p, tricks, suit);
    } else {
      s = pass(s, p);
    }
  }
  expect(s.phase).toBe('PARTNER_CALL');
  expect(s.auction.declarer).toBe(declarer);
  return s;
}

// ---------- deck / deal ----------

describe('Deck and deal', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(c => `${c.rank}-${c.suit}`)).size).toBe(52);
  });

  it('deals 13 unique cards to each of 4 players with no overlap', () => {
    const hands = dealCards(createDeck());
    expect(hands).toHaveLength(4);
    const all = new Set<string>();
    for (const hand of hands) {
      expect(hand).toHaveLength(13);
      hand.forEach(c => all.add(`${c.rank}-${c.suit}`));
    }
    expect(all.size).toBe(52);
  });
});

// ---------- auction ----------

describe('Auction', () => {
  it('orders bids by trick target then Spades > Hearts > Clubs > Diamonds', () => {
    const bid = (tricks: number, suit: Suit) => ({ player: 0 as PlayerIndex, tricks, suit });
    expect(compareBids(bid(5, 'Clubs'), bid(5, 'Diamonds'))).toBeGreaterThan(0);
    expect(compareBids(bid(5, 'Hearts'), bid(5, 'Clubs'))).toBeGreaterThan(0);
    expect(compareBids(bid(5, 'Spades'), bid(5, 'Hearts'))).toBeGreaterThan(0);
    expect(compareBids(bid(6, 'Diamonds'), bid(5, 'Spades'))).toBeGreaterThan(0);
    expect(isHigherBid(bid(5, 'Spades'), bid(5, 'Spades'))).toBe(false);
  });

  it('offers every bid 1..13 in all suits to the opener, whoever they are', () => {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      expect(getLegalBids(null, p)).toHaveLength(52);
    }
  });

  it('offers only strictly higher bids once a bid exists', () => {
    const legal = getLegalBids({ player: 1, tricks: 5, suit: 'Hearts' }, 0);
    expect(legal.some(b => b.tricks === 5 && b.suit === 'Hearts')).toBe(false);
    expect(legal.some(b => b.tricks === 5 && b.suit === 'Clubs')).toBe(false);
    expect(legal.some(b => b.tricks === 5 && b.suit === 'Spades')).toBe(true);
    expect(legal.some(b => b.tricks === 6 && b.suit === 'Diamonds')).toBe(true);
    expect(legal.every(b => b.tricks >= 5)).toBe(true);
  });

  it('first bidder is dealer\'s left and cannot pass', () => {
    const state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    expect(getFirstBidder(state)).toBe(1);
    expect(state.currentPlayer).toBe(1);
    expect(canPass(state, 1)).toBe(false);
    expect(() => pass(state, 1)).toThrow('First player cannot pass');
  });

  it('allows a pass once an opening bid exists', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 3, 'Hearts');
    expect(canPass(state, 2)).toBe(true);
    expect(() => pass(state, 2)).not.toThrow();
  });

  it('rejects a bid that is not higher than the current bid', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 5, 'Hearts');
    expect(() => makeBid(state, 2, 5, 'Hearts')).toThrow('Bid must be higher');
    expect(() => makeBid(state, 2, 5, 'Clubs')).toThrow('Bid must be higher');
    expect(() => makeBid(state, 2, 4, 'Spades')).toThrow('Bid must be higher');
  });

  it('rejects trick targets outside 1..13', () => {
    const state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    expect(() => makeBid(state, 1, 0, 'Spades')).toThrow('between 1 and 13');
    expect(() => makeBid(state, 1, 14, 'Spades')).toThrow('between 1 and 13');
    expect(() => makeBid(state, 1, 2.5, 'Spades')).toThrow('between 1 and 13');
    expect(() => makeBid(state, 1, NaN, 'Spades')).toThrow('between 1 and 13');
  });

  it('a player who passed cannot bid again and is skipped', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 3, 'Hearts');
    state = pass(state, 2);
    state = makeBid(state, 3, 4, 'Hearts');
    state = makeBid(state, 0, 5, 'Hearts');
    state = makeBid(state, 1, 6, 'Hearts');
    // North (2) has passed: turn goes 1 -> 3, skipping 2.
    expect(state.currentPlayer).toBe(3);
    expect(() => makeBid({ ...state, currentPlayer: 2 }, 2, 7, 'Hearts')).toThrow('Player has passed');
  });

  it('ends when one active bidder remains and sets declarer and contract', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 5, 'Hearts');
    state = makeBid(state, 2, 6, 'Clubs');
    state = pass(state, 3);
    state = makeBid(state, 0, 6, 'Hearts');
    state = pass(state, 1);
    state = pass(state, 2);
    expect(state.phase).toBe('PARTNER_CALL');
    expect(state.auction.declarer).toBe(0);
    expect(state.contract).toEqual({ tricksRequired: 6, trumpSuit: 'Hearts' });
    expect(state.auction.log).toHaveLength(6);
    expect(state.auction.log[2]).toEqual({ player: 3, bid: null });
  });

  it('opener wins if everyone else passes', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 4, 'Spades');
    state = pass(state, 2);
    state = pass(state, 3);
    state = pass(state, 0);
    expect(state.auction.declarer).toBe(1);
    expect(state.contract).toEqual({ tricksRequired: 4, trumpSuit: 'Spades' });
  });
});

// ---------- partner call ----------

describe('Partner call', () => {
  it('rejects a card in the declarer\'s own hand', () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 5, 'Hearts');
    expect(() => callPartner(state, 1, createCard('Hearts', 'A'))).toThrow('Cannot call a card in your own hand');
  });

  it('identifies partner by the called card and the other two as defenders', () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 5, 'Hearts');
    // Diamonds are all with East (3).
    const next = callPartner(state, 1, createCard('Diamonds', 'A'));
    expect(next.phase).toBe('TRICK_PLAY');
    expect(next.partnerships).toEqual({ declarer: 1, partner: 3, defenders: [0, 2] });
    expect(next.calledCard).toEqual(createCard('Diamonds', 'A'));
  });

  it('player to declarer\'s left leads the first trick', () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 5, 'Hearts');
    const next = callPartner(state, 1, createCard('Clubs', 'A'));
    expect(next.tricks.current?.leader).toBe(2);
    expect(next.currentPlayer).toBe(2);
  });
});

// ---------- trick play ----------

/** Contract 7 Spades by South, partner North (holds AC). West leads. */
function playState(): GameState {
  const s = auctionWonBy(createStateFromHands(mixedHands(), 3), 0, 7, 'Spades');
  return callPartner(s, 0, createCard('Clubs', 'A'));
}

describe('Trick play', () => {
  it('must follow suit when able', () => {
    let s = playState();
    expect(s.currentPlayer).toBe(1);
    s = playCard(s, 1, createCard('Hearts', '8')); // West leads a heart
    // North (2) has no hearts: may play anything.
    expect(getLegalPlays(s, 2)).toHaveLength(13);
    s = playCard(s, 2, createCard('Diamonds', '9'));
    // East (3) has no hearts either.
    s = playCard(s, 3, createCard('Diamonds', '2'));
    // South holds hearts and must follow.
    expect(getLegalPlays(s, 0).every(c => c.suit === 'Hearts')).toBe(true);
    expect(() => playCard(s, 0, createCard('Spades', 'A'))).toThrow('Must follow suit');
  });

  it('a discard when void cannot win; highest led-suit card wins with no trump', () => {
    let s = playState();
    s = playCard(s, 1, createCard('Hearts', '8'));
    s = playCard(s, 2, createCard('Diamonds', 'A')); // discard
    s = playCard(s, 3, createCard('Diamonds', '2'));
    s = playCard(s, 0, createCard('Hearts', '9'));
    const trick = s.tricks.completed[0];
    expect(trick.winner).toBe(0);
  });

  it('trump beats the led suit, and the higher trump wins', () => {
    expect(compareCardsInTrick(createCard('Spades', '2'), createCard('Hearts', 'A'), 'Hearts', 'Spades')).toBeGreaterThan(0);
    expect(compareCardsInTrick(createCard('Spades', '10'), createCard('Spades', '2'), 'Hearts', 'Spades')).toBeGreaterThan(0);
    expect(compareCardsInTrick(createCard('Hearts', 'K'), createCard('Hearts', 'A'), 'Hearts', 'Spades')).toBeLessThan(0);

    let s = playState();
    s = playCard(s, 1, createCard('Hearts', '8'));
    s = playCard(s, 2, createCard('Clubs', '8'));
    s = playCard(s, 3, createCard('Clubs', '2'));
    s = playCard(s, 0, createCard('Hearts', 'A'));
    expect(s.tricks.completed[0].winner).toBe(0);

    // Now South leads a low spade; West must follow with a spade, and a higher one wins.
    s = playCard(s, 0, createCard('Spades', '8'));
    s = playCard(s, 1, createCard('Spades', '7'));
    s = playCard(s, 2, createCard('Clubs', '9'));
    s = playCard(s, 3, createCard('Clubs', '3'));
    expect(s.tricks.completed[1].winner).toBe(0);
  });

  it('trick winner leads the next trick', () => {
    let s = playState();
    s = playCard(s, 1, createCard('Hearts', '2'));
    s = playCard(s, 2, createCard('Clubs', '8'));
    s = playCard(s, 3, createCard('Clubs', '2'));
    s = playCard(s, 0, createCard('Hearts', '9'));
    expect(s.tricks.completed[0].winner).toBe(0);
    expect(s.tricks.current?.leader).toBe(0);
    expect(s.currentPlayer).toBe(0);
    expect(s.tricks.current?.cards).toHaveLength(0);
  });

  it('trick winner leads next even when they were not the last to play', () => {
    // Same deal but East holds 8S instead of 2D, so East can ruff West's heart lead.
    const hands = mixedHands();
    hands[0] = hands[0].filter(c => !(c.rank === '8' && c.suit === 'Spades')).concat(createCard('Diamonds', '2'));
    hands[3] = hands[3].filter(c => !(c.rank === '2' && c.suit === 'Diamonds')).concat(createCard('Spades', '8'));
    let s = auctionWonBy(createStateFromHands(hands, 3), 0, 7, 'Spades');
    s = callPartner(s, 0, createCard('Clubs', 'A'));
    s = playCard(s, 1, createCard('Hearts', '8'));
    s = playCard(s, 2, createCard('Diamonds', '9'));
    s = playCard(s, 3, createCard('Spades', '8')); // ruff
    s = playCard(s, 0, createCard('Hearts', '9')); // must follow, cannot beat a trump
    expect(s.tricks.completed[0].winner).toBe(3);
    expect(s.tricks.current?.leader).toBe(3);
    expect(s.currentPlayer).toBe(3);
  });

  it('rejects a card not in hand and never lets a card be played twice', () => {
    let s = playState();
    expect(() => playCard(s, 1, createCard('Spades', 'A'))).toThrow('Card not in hand');
    s = playCard(s, 1, createCard('Hearts', '8'));
    expect(s.hands[1].some(c => c.rank === '8' && c.suit === 'Hearts')).toBe(false);
  });
});

// ---------- contract result ----------

/**
 * South holds every spade and declares `target` Spades with North as partner.
 * West leads; South trumps trick 1 then leads spades, so South wins all 13.
 */
function southSweeps(target: number): GameState {
  let s = auctionWonBy(createStateFromHands(suitPerPlayer(), 3), 0, target, 'Spades');
  s = callPartner(s, 0, createCard('Clubs', 'A'));
  let guard = 0;
  while (s.phase === 'TRICK_PLAY' && guard++ < 60) {
    const p = s.currentPlayer!;
    s = playCard(s, p, getLegalPlays(s, p)[0]);
  }
  expect(s.phase).toBe('HAND_RESULT');
  expect(s.result!.tricksWonByDeclarer).toBe(13);
  return s;
}

describe('Contract result', () => {
  /**
   * Deal for result tests: South holds spades 2-9 plus hearts 2-6 (13 cards).
   * Trump is Hearts, declared by West at `target`; partner North (holds AC).
   * West holds A-K-Q-J-10 of hearts plus spades 10-A and clubs 2-4; so the
   * West+North side wins every trick West trumps or leads high.
   */
  function playOut(target: number, chooser: (s: GameState, legal: Card[]) => Card): GameState {
    const south = cards('9S 8S 7S 6S 5S 4S 3S 2S 6H 5H 4H 3H 2H');
    const west = cards('AH KH QH JH 10H AS KS QS JS 10S 4C 3C 2C');
    const north = cards('AC KC QC JC 10C 9C 8C 7C 6C 5C AD KD QD');
    const east = cards('9H 8H 7H JD 10D 9D 8D 7D 6D 5D 4D 3D 2D');
    let s = auctionWonBy(createStateFromHands([south, west, north, east], 0), 1, target, 'Hearts');
    s = callPartner(s, 1, createCard('Clubs', 'A'));
    let guard = 0;
    while (s.phase === 'TRICK_PLAY' && guard++ < 60) {
      const p = s.currentPlayer!;
      s = playCard(s, p, chooser(s, getLegalPlays(s, p)));
    }
    expect(s.phase).toBe('HAND_RESULT');
    return s;
  }
  const highest = (legal: Card[]) => [...legal].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank))[0];
  const lowest = (legal: Card[]) => [...legal].sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank))[0];

  // Everyone plays their highest legal card: West+North dominate.
  const aggressive = (_: GameState, legal: Card[]) => highest(legal);
  // Declarer side dumps low cards; defenders play high.
  const passive = (s: GameState, legal: Card[]) =>
    (s.currentPlayer === 1 || s.currentPlayer === 2) ? lowest(legal) : highest(legal);

  it('exactly the target succeeds and above the target succeeds', () => {
    const s = playOut(1, aggressive);
    const won = s.result!.tricksWonByDeclarer;
    expect(won).toBeGreaterThanOrEqual(1);
    expect(s.result!.contractMade).toBe(true);
    expect(isContractMade(s)).toBe(true);
    // Exactly the target: re-run with target equal to the tricks actually won.
    const exact = playOut(won, aggressive);
    expect(exact.result!.tricksWonByDeclarer).toBe(won);
    expect(exact.result!.contractMade).toBe(true);
  });

  it('below the target fails', () => {
    const s = playOut(13, passive);
    expect(s.result!.tricksWonByDeclarer).toBeLessThan(13);
    expect(s.result!.contractMade).toBe(false);
    expect(isContractMade(s)).toBe(false);
  });

  it('a 13 target succeeds only with all 13 tricks', () => {
    expect(southSweeps(13).result!.contractMade).toBe(true);
    expect(southSweeps(7).result!.contractMade).toBe(true); // above target
    const short = playOut(13, passive);
    expect(short.result!.tricksWonByDeclarer).toBeLessThan(13);
    expect(short.result!.contractMade).toBe(false);
  });

  it('every card is played exactly once over 13 tricks', () => {
    const s = playOut(5, aggressive);
    expect(s.tricks.completed).toHaveLength(13);
    const seen = new Set<string>();
    for (const t of s.tricks.completed) {
      expect(t.cards).toHaveLength(4);
      t.cards.forEach(c => seen.add(`${c.card.rank}-${c.card.suit}`));
    }
    expect(seen.size).toBe(52);
    expect(s.hands.every(h => h.length === 0)).toBe(true);
  });
});

// ---------- hidden partner variant ----------

describe('Hidden partner rules', () => {
  const hidden = { hiddenPartner: true };
  /** West declares 5 Hearts, calls AC (North). North leads. */
  function hiddenState() {
    const s = auctionWonBy(createStateFromHands(suitPerPlayer(), 0, hidden), 1, 5, 'Hearts');
    return callPartner(s, 1, createCard('Clubs', 'A'));
  }

  it('standard rules: partnership is public as soon as the card is called', () => {
    const s = callPartner(auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 5, 'Hearts'), 1, createCard('Clubs', 'A'));
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'opponent', 3: 'ally' });
  });

  it('hidden rules: only the partner knows the sides before the card is played', () => {
    const s = hiddenState();
    expect(isPartnershipPublic(s)).toBe(false);
    expect(isCalledCardPlayed(s)).toBe(false);
    // Declarer (West) knows nothing beyond self.
    expect(getSideKnowledge(s, 1)).toEqual({ 0: 'unknown', 1: 'self', 2: 'unknown', 3: 'unknown' });
    // Partner (North) knows everything.
    expect(getSideKnowledge(s, 2)).toEqual({ 0: 'opponent', 1: 'ally', 2: 'self', 3: 'opponent' });
    // Defenders know only that the declarer is an opponent.
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'unknown', 3: 'unknown' });
    expect(getSideKnowledge(s, 3)).toEqual({ 0: 'unknown', 1: 'opponent', 2: 'unknown', 3: 'self' });
  });

  it('hidden rules: playing the called card reveals the partnership to all', () => {
    let s = hiddenState();
    s = playCard(s, 2, createCard('Clubs', 'A')); // North leads the called card
    expect(isCalledCardPlayed(s)).toBe(true);
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 1)).toEqual({ 0: 'opponent', 1: 'self', 2: 'ally', 3: 'opponent' });
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'opponent', 3: 'ally' });
  });

  it('AI plays complete legal hands under both rule sets', () => {
    for (const hiddenPartner of [false, true]) {
      for (let dealer = 0; dealer < 4; dealer++) {
        for (let i = 0; i < 25; i++) {
          let s = startAuction(createInitialState(dealer as PlayerIndex, { hiddenPartner }));
          let guard = 0;
          while (s.phase !== 'HAND_RESULT' && guard++ < 200) {
            const p = s.currentPlayer!;
            const d = makeAiDecision(s, p);
            if (d.action === 'bid') s = makeBid(s, p, d.bid!.tricks, d.bid!.suit);
            else if (d.action === 'pass') s = pass(s, p);
            else if (d.action === 'call') s = callPartner(s, p, d.card!);
            else s = playCard(s, p, d.card!);
          }
          expect(s.phase).toBe('HAND_RESULT');
          expect(s.tricks.completed).toHaveLength(13);
          expect(s.contract!.tricksRequired).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('rules carry over to the next hand', () => {
    const s = startNextHand(hiddenState());
    expect(s.rules).toEqual(hidden);
    expect(s.phase).toBe('DEALING');
  });
});

describe('Suit constants', () => {
  it('SUITS and RANKS cover the deck', () => {
    expect(SUITS).toHaveLength(4);
    expect(RANKS).toHaveLength(13);
  });
});
