import { describe, it, expect } from 'vitest';
import type { Card, GameState, PlayerIndex, Rank, Strain, Suit } from '../src/engine/types';
import {
  createDeck, dealCards, compareBids, getLegalBids, isHigherBid, createCard, contractFor,
  SUITS, RANKS, DEFAULT_RULES, handPoints, isWash, isSolo,
} from '../src/engine/types';
import {
  createStateFromHands, startAuction, makeBid, pass, canPass, getFirstBidder, countTricksWon,
  callPartner, playCard, getLegalPlays, isContractMade, meetsContract, startNextHand,
  getSideKnowledge, isPartnershipPublic, isCalledCardPlayed, createInitialState, MAX_WASHES,
} from '../src/engine/gameEngine';
import { compareCardsInTrick } from '../src/engine/trickEvaluator';
import { makeAiDecision, MAX_AI_LEVEL } from '../src/ai/aiPlayer';

// ---------- fixtures ----------

const OPEN = { ...DEFAULT_RULES, hiddenPartner: false };

/** Parse "AS KH 10D ..." into cards. */
function cards(spec: string): Card[] {
  const suitOf: Record<string, Suit> = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
  return spec.trim().split(/\s+/).map(tok => ({
    rank: tok.slice(0, -1) as Rank,
    suit: suitOf[tok.slice(-1)],
  }));
}

/** Each player gets one whole suit: South Spades, West Hearts, North Clubs, East Diamonds. */
function suitPerPlayer(order: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds']): Card[][] {
  return order.map(suit => RANKS.map(rank => ({ suit, rank })));
}

/** Mixed hands so follow-suit and discard cases both occur. */
function mixedHands(): Card[][] {
  const south = cards('AS KS QS JS 10S 9S 8S AH KH QH JH 10H 9H');
  const west = cards('7S 6S 5S 4S 3S 2S 8H 7H 6H 5H 4H 3H 2H');
  const north = cards('AC KC QC JC 10C 9C 8C AD KD QD JD 10D 9D');
  const east = cards('7C 6C 5C 4C 3C 2C 8D 7D 6D 5D 4D 3D 2D');
  return [south, west, north, east];
}

/** Auction where `declarer` wins with `level strain`: opener bids 1♦ if needed, others pass. */
function auctionWonBy(state: GameState, declarer: PlayerIndex, level: number, strain: Strain): GameState {
  let s = startAuction(state);
  const opener = getFirstBidder(s);
  if (opener !== declarer) s = makeBid(s, opener, 1, 'Diamonds');
  let guard = 0;
  while (s.phase === 'AUCTION' && guard++ < 8) {
    const p = s.currentPlayer!;
    if (p === declarer && !s.auction.bids.some(b => b.player === declarer)) {
      s = makeBid(s, p, level, strain);
    } else {
      s = pass(s, p);
    }
  }
  expect(s.phase).toBe('PARTNER_CALL');
  expect(s.auction.declarer).toBe(declarer);
  return s;
}

function aiPlayHand(s: GameState, until: GameState['phase'] = 'HAND_RESULT'): GameState {
  let guard = 0;
  while (s.phase !== until && guard++ < 200) {
    const p = s.currentPlayer!;
    const d = makeAiDecision(s, p);
    if (d.action === 'bid') s = makeBid(s, p, d.bid!.level, d.bid!.strain);
    else if (d.action === 'pass') s = pass(s, p);
    else if (d.action === 'call') s = callPartner(s, p, d.card!);
    else s = playCard(s, p, d.card!);
  }
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
  const bid = (level: number, strain: Strain) => ({ player: 0 as PlayerIndex, level, strain });

  it('orders bids by level, then NT > Spades > Hearts > Clubs > Diamonds', () => {
    expect(compareBids(bid(1, 'Clubs'), bid(1, 'Diamonds'))).toBeGreaterThan(0);
    expect(compareBids(bid(1, 'Hearts'), bid(1, 'Clubs'))).toBeGreaterThan(0);
    expect(compareBids(bid(1, 'Spades'), bid(1, 'Hearts'))).toBeGreaterThan(0);
    expect(compareBids(bid(1, 'NoTrump'), bid(1, 'Spades'))).toBeGreaterThan(0);
    expect(compareBids(bid(2, 'Diamonds'), bid(1, 'NoTrump'))).toBeGreaterThan(0);
    expect(isHigherBid(bid(3, 'Spades'), bid(3, 'Spades'))).toBe(false);
  });

  it('uses a book of six: level 1 = 7 tricks, level 7 = 13, no trump has no trump suit', () => {
    expect(contractFor({ level: 1, strain: 'Hearts' })).toEqual({ level: 1, strain: 'Hearts', tricksRequired: 7, trumpSuit: 'Hearts' });
    expect(contractFor({ level: 7, strain: 'NoTrump' })).toEqual({ level: 7, strain: 'NoTrump', tricksRequired: 13, trumpSuit: null });
  });

  it('offers every bid 1..7 in all five strains to the opener, whoever they are', () => {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      expect(getLegalBids(null, p)).toHaveLength(35);
    }
  });

  it('offers only strictly higher bids once a bid exists', () => {
    const legal = getLegalBids({ player: 1, level: 2, strain: 'Hearts' }, 0);
    const has = (level: number, strain: Strain) => legal.some(b => b.level === level && b.strain === strain);
    expect(has(2, 'Hearts')).toBe(false);
    expect(has(2, 'Clubs')).toBe(false);
    expect(has(2, 'Spades')).toBe(true);
    expect(has(2, 'NoTrump')).toBe(true);
    expect(has(3, 'Diamonds')).toBe(true);
    expect(legal.every(b => b.level >= 2)).toBe(true);
  });

  it("first bidder is dealer's left and cannot pass", () => {
    const state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    expect(getFirstBidder(state)).toBe(1);
    expect(state.currentPlayer).toBe(1);
    expect(canPass(state, 1)).toBe(false);
    expect(() => pass(state, 1)).toThrow('First player cannot pass');
  });

  it('allows a pass once an opening bid exists', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 1, 'Hearts');
    expect(canPass(state, 2)).toBe(true);
    expect(() => pass(state, 2)).not.toThrow();
  });

  it('rejects a bid that is not higher than the current bid', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 2, 'Hearts');
    expect(() => makeBid(state, 2, 2, 'Hearts')).toThrow('Bid must be higher');
    expect(() => makeBid(state, 2, 2, 'Clubs')).toThrow('Bid must be higher');
    expect(() => makeBid(state, 2, 1, 'NoTrump')).toThrow('Bid must be higher');
  });

  it('rejects levels outside 1..7', () => {
    const state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    for (const level of [0, 8, 1.5, NaN]) {
      expect(() => makeBid(state, 1, level, 'Spades')).toThrow('between 1 and 7');
    }
  });

  it('a player who passed cannot bid again and is skipped', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 1, 'Hearts');
    state = pass(state, 2);
    state = makeBid(state, 3, 1, 'Spades');
    state = makeBid(state, 0, 1, 'NoTrump');
    state = makeBid(state, 1, 2, 'Hearts');
    // North (2) has passed: turn goes 1 -> 3, skipping 2.
    expect(state.currentPlayer).toBe(3);
    expect(() => makeBid({ ...state, currentPlayer: 2 }, 2, 3, 'Hearts')).toThrow('Player has passed');
  });

  it('ends when one active bidder remains and sets declarer and contract', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 1, 'Hearts');
    state = makeBid(state, 2, 2, 'Clubs');
    state = pass(state, 3);
    state = makeBid(state, 0, 2, 'Hearts');
    state = pass(state, 1);
    state = pass(state, 2);
    expect(state.phase).toBe('PARTNER_CALL');
    expect(state.auction.declarer).toBe(0);
    expect(state.contract).toEqual({ level: 2, strain: 'Hearts', tricksRequired: 8, trumpSuit: 'Hearts' });
    expect(state.auction.log).toHaveLength(6);
    expect(state.auction.log[2]).toEqual({ player: 3, bid: null });
  });

  it('opener wins if everyone else passes', () => {
    let state = startAuction(createStateFromHands(suitPerPlayer(), 0));
    state = makeBid(state, 1, 1, 'NoTrump');
    state = pass(state, 2);
    state = pass(state, 3);
    state = pass(state, 0);
    expect(state.auction.declarer).toBe(1);
    expect(state.contract).toEqual({ level: 1, strain: 'NoTrump', tricksRequired: 7, trumpSuit: null });
  });
});

// ---------- partner call ----------

describe('Partner call', () => {
  it("allows a card in the declarer's own hand: declarer plays alone against three", () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 1, 'Hearts');
    const next = callPartner(state, 1, createCard('Hearts', 'A')); // all hearts are West's
    expect(next.phase).toBe('TRICK_PLAY');
    expect(next.partnerships).toEqual({ declarer: 1, partner: 1, defenders: [0, 2, 3] });
    expect(isSolo(next.partnerships!)).toBe(true);
    expect(next.tricks.current?.leader).toBe(2);
  });

  it('a solo declarer counts only their own tricks', () => {
    const trick = (winner: PlayerIndex) => ({ cards: [], leader: winner, winner, ledSuit: null, trumpSuit: null });
    const tricks = [trick(1), trick(1), trick(2), trick(3), trick(0)];
    expect(countTricksWon(tricks, { declarer: 1, partner: 1, defenders: [0, 2, 3] })).toBe(2);
    expect(countTricksWon(tricks, { declarer: 1, partner: 3, defenders: [0, 2] })).toBe(3);
  });

  it('identifies partner by the called card and the other two as defenders', () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 1, 'Hearts');
    const next = callPartner(state, 1, createCard('Diamonds', 'A')); // all diamonds are East's
    expect(next.phase).toBe('TRICK_PLAY');
    expect(next.partnerships).toEqual({ declarer: 1, partner: 3, defenders: [0, 2] });
    expect(next.calledCard).toEqual(createCard('Diamonds', 'A'));
  });

  it("suit contract: the player to declarer's left leads", () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 1, 'Hearts');
    const next = callPartner(state, 1, createCard('Clubs', 'A'));
    expect(next.tricks.current?.leader).toBe(2);
    expect(next.currentPlayer).toBe(2);
    expect(next.tricks.current?.trumpSuit).toBe('Hearts');
  });

  it('no-trump contract: declarer leads', () => {
    const state = auctionWonBy(createStateFromHands(suitPerPlayer(), 0), 1, 1, 'NoTrump');
    const next = callPartner(state, 1, createCard('Clubs', 'A'));
    expect(next.tricks.current?.leader).toBe(1);
    expect(next.currentPlayer).toBe(1);
    expect(next.tricks.current?.trumpSuit).toBeNull();
  });
});

// ---------- trick play ----------

/** Contract 1♠ by South (7 tricks), partner North (holds AC). West leads. */
function playState(): GameState {
  const s = auctionWonBy(createStateFromHands(mixedHands(), 3), 0, 1, 'Spades');
  return callPartner(s, 0, createCard('Clubs', 'A'));
}

describe('Trick play', () => {
  it('must follow suit when able', () => {
    let s = playState();
    expect(s.currentPlayer).toBe(1);
    s = playCard(s, 1, createCard('Hearts', '8'));
    expect(getLegalPlays(s, 2)).toHaveLength(13); // North has no hearts
    s = playCard(s, 2, createCard('Diamonds', '9'));
    s = playCard(s, 3, createCard('Diamonds', '2'));
    expect(getLegalPlays(s, 0).every(c => c.suit === 'Hearts')).toBe(true);
    expect(() => playCard(s, 0, createCard('Spades', 'A'))).toThrow('Must follow suit');
  });

  it('a discard when void cannot win; highest led-suit card wins with no trump played', () => {
    let s = playState();
    s = playCard(s, 1, createCard('Hearts', '8'));
    s = playCard(s, 2, createCard('Diamonds', 'A'));
    s = playCard(s, 3, createCard('Diamonds', '2'));
    s = playCard(s, 0, createCard('Hearts', '9'));
    expect(s.tricks.completed[0].winner).toBe(0);
  });

  it('trump beats the led suit, and the higher trump wins', () => {
    expect(compareCardsInTrick(createCard('Spades', '2'), createCard('Hearts', 'A'), 'Hearts', 'Spades')).toBeGreaterThan(0);
    expect(compareCardsInTrick(createCard('Spades', '10'), createCard('Spades', '2'), 'Hearts', 'Spades')).toBeGreaterThan(0);
    expect(compareCardsInTrick(createCard('Hearts', 'K'), createCard('Hearts', 'A'), 'Hearts', 'Spades')).toBeLessThan(0);
  });

  it('in no trump nothing beats the led suit', () => {
    expect(compareCardsInTrick(createCard('Spades', 'A'), createCard('Hearts', '2'), 'Hearts', null)).toBeLessThan(0);
    expect(compareCardsInTrick(createCard('Hearts', '3'), createCard('Hearts', '2'), 'Hearts', null)).toBeGreaterThan(0);
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
    // East holds 8S instead of 2D, so East can ruff West's heart lead.
    const hands = mixedHands();
    hands[0] = hands[0].filter(c => !(c.rank === '8' && c.suit === 'Spades')).concat(createCard('Diamonds', '2'));
    hands[3] = hands[3].filter(c => !(c.rank === '2' && c.suit === 'Diamonds')).concat(createCard('Spades', '8'));
    let s = auctionWonBy(createStateFromHands(hands, 3), 0, 1, 'Spades');
    s = callPartner(s, 0, createCard('Clubs', 'A'));
    s = playCard(s, 1, createCard('Hearts', '8'));
    s = playCard(s, 2, createCard('Diamonds', '9'));
    s = playCard(s, 3, createCard('Spades', '8')); // ruff
    s = playCard(s, 0, createCard('Hearts', '9'));
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

/** South holds every spade and declares `level` Spades with North as partner: wins all 13. */
function southSweeps(level: number): GameState {
  let s = auctionWonBy(createStateFromHands(suitPerPlayer(), 3), 0, level, 'Spades');
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
  /** West declares Hearts with North as partner (holds AC); chooser picks each card. */
  function playOut(level: number, chooser: (s: GameState, legal: Card[]) => Card): GameState {
    const south = cards('9S 8S 7S 6S 5S 4S 3S 2S 6H 5H 4H 3H 2H');
    const west = cards('AH KH QH JH 10H AS KS QS JS 10S 4C 3C 2C');
    const north = cards('AC KC QC JC 10C 9C 8C 7C 6C 5C AD KD QD');
    const east = cards('9H 8H 7H JD 10D 9D 8D 7D 6D 5D 4D 3D 2D');
    let s = auctionWonBy(createStateFromHands([south, west, north, east], 0), 1, level, 'Hearts');
    s = callPartner(s, 1, createCard('Clubs', 'A'));
    let guard = 0;
    while (s.phase === 'TRICK_PLAY' && guard++ < 60) {
      const p = s.currentPlayer!;
      s = playCard(s, p, chooser(s, getLegalPlays(s, p)));
    }
    expect(s.phase).toBe('HAND_RESULT');
    return s;
  }
  const byRank = (legal: Card[], dir: 1 | -1) => [...legal].sort((a, b) => dir * (RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)))[0];
  const aggressive = (_: GameState, legal: Card[]) => byRank(legal, 1);
  const passive = (s: GameState, legal: Card[]) =>
    (s.currentPlayer === 1 || s.currentPlayer === 2) ? byRank(legal, -1) : byRank(legal, 1);

  it('exactly the target succeeds, above succeeds, below fails', () => {
    expect(meetsContract(7, 7)).toBe(true);
    expect(meetsContract(8, 7)).toBe(true);
    expect(meetsContract(6, 7)).toBe(false);
    expect(meetsContract(12, 13)).toBe(false);
  });

  it('level 7 (13 tricks) succeeds only with all 13 tricks', () => {
    const sweep = southSweeps(7);
    expect(sweep.contract!.tricksRequired).toBe(13);
    expect(sweep.result!.contractMade).toBe(true);
    expect(isContractMade(sweep)).toBe(true);
    expect(southSweeps(1).result!.contractMade).toBe(true); // 13 of 7: above target

    const short = playOut(7, passive);
    expect(short.result!.tricksWonByDeclarer).toBeLessThan(13);
    expect(short.result!.contractMade).toBe(false);
    expect(isContractMade(short)).toBe(false);
  });

  it('every card is played exactly once over 13 tricks', () => {
    const s = playOut(1, aggressive);
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
  const hidden = { ...DEFAULT_RULES, hiddenPartner: true };
  /** West declares 1♥, calls AC (North). North leads. */
  function hiddenState() {
    const s = auctionWonBy(createStateFromHands(suitPerPlayer(), 0, hidden), 1, 1, 'Hearts');
    return callPartner(s, 1, createCard('Clubs', 'A'));
  }

  it('is the default', () => {
    expect(DEFAULT_RULES.hiddenPartner).toBe(true);
    expect(createStateFromHands(suitPerPlayer()).rules.hiddenPartner).toBe(true);
  });

  it('open rules: partnership is public as soon as the card is called', () => {
    const s = callPartner(auctionWonBy(createStateFromHands(suitPerPlayer(), 0, OPEN), 1, 1, 'Hearts'), 1, createCard('Clubs', 'A'));
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'opponent', 3: 'ally' });
  });

  it('hidden rules: only the partner knows the sides before the card is played', () => {
    const s = hiddenState();
    expect(isPartnershipPublic(s)).toBe(false);
    expect(isCalledCardPlayed(s)).toBe(false);
    expect(getSideKnowledge(s, 1)).toEqual({ 0: 'unknown', 1: 'self', 2: 'unknown', 3: 'unknown' });
    expect(getSideKnowledge(s, 2)).toEqual({ 0: 'opponent', 1: 'ally', 2: 'self', 3: 'opponent' });
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'unknown', 3: 'unknown' });
    expect(getSideKnowledge(s, 3)).toEqual({ 0: 'unknown', 1: 'opponent', 2: 'unknown', 3: 'self' });
  });

  it('hidden rules: playing the called card reveals the partnership to all', () => {
    let s = hiddenState();
    s = playCard(s, 2, createCard('Clubs', 'A'));
    expect(isCalledCardPlayed(s)).toBe(true);
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 1)).toEqual({ 0: 'opponent', 1: 'self', 2: 'ally', 3: 'opponent' });
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'opponent', 3: 'ally' });
  });

  it('hidden rules, solo call: defenders cannot tell until the declarer plays the called card', () => {
    // West declares 1♥ and calls 2H from their own hand. North leads.
    let s = auctionWonBy(createStateFromHands(suitPerPlayer(), 0, hidden), 1, 1, 'Hearts');
    s = callPartner(s, 1, createCard('Hearts', '2'));
    expect(isPartnershipPublic(s)).toBe(false);
    expect(getSideKnowledge(s, 1)).toEqual({ 0: 'opponent', 1: 'self', 2: 'opponent', 3: 'opponent' });
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'unknown', 3: 'unknown' });
    expect(getSideKnowledge(s, 2)).toEqual({ 0: 'unknown', 1: 'opponent', 2: 'self', 3: 'unknown' });
    // North leads a club, East a diamond, South a spade, then West must play a heart: the 2H reveal.
    s = playCard(s, 2, createCard('Clubs', 'A'));
    s = playCard(s, 3, createCard('Diamonds', 'A'));
    s = playCard(s, 0, createCard('Spades', 'A'));
    expect(isPartnershipPublic(s)).toBe(false);
    s = playCard(s, 1, createCard('Hearts', '2'));
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 0)).toEqual({ 0: 'self', 1: 'opponent', 2: 'ally', 3: 'ally' });
  });

  it('open rules, solo call: everyone knows at once', () => {
    const s = callPartner(auctionWonBy(createStateFromHands(suitPerPlayer(), 0, OPEN), 1, 1, 'Hearts'), 1, createCard('Hearts', '2'));
    expect(isPartnershipPublic(s)).toBe(true);
    expect(getSideKnowledge(s, 3)).toEqual({ 0: 'ally', 1: 'opponent', 2: 'ally', 3: 'self' });
  });

  it('AI plays complete legal hands under both rule sets', () => {
    let noTrumpContracts = 0;
    let noTrumpDeclarerLed = 0;
    for (const hiddenPartner of [false, true]) {
      for (let dealer = 0; dealer < 4; dealer++) {
        for (let i = 0; i < 25; i++) {
          const s = aiPlayHand(startAuction(createInitialState(dealer as PlayerIndex, { ...DEFAULT_RULES, hiddenPartner })));
          expect(s.phase).toBe('HAND_RESULT');
          expect(s.tricks.completed).toHaveLength(13);
          expect(s.contract!.level).toBeLessThanOrEqual(MAX_AI_LEVEL);
          if (s.contract!.strain === 'NoTrump') {
            noTrumpContracts++;
            if (s.tricks.completed[0].leader === s.partnerships!.declarer) noTrumpDeclarerLed++;
          }
        }
      }
    }
    expect(noTrumpContracts).toBeGreaterThan(0);
    expect(noTrumpDeclarerLed).toBe(noTrumpContracts);
  });

  it('rules carry over to the next hand', () => {
    const s = startNextHand(hiddenState());
    expect(s.rules).toEqual(hidden);
    expect(s.phase).toBe('DEALING');
  });
});

// ---------- wash variant ----------

describe('Wash rules', () => {
  /** South holds 12 small cards and one jack: 1 point. */
  function weakSouthDeal(): Card[][] {
    return [
      cards('JS 2S 3S 4S 2H 3H 4H 2C 3C 4C 2D 3D 4D'),
      cards('AS KS QS 5S 6S 7S 5H 6H 7H 5C 6C 7C 5D'),
      cards('AH KH QH JH 8H 9H 10H 8C 9C 10C 6D 7D 8D'),
      cards('AC KC QC JC AD KD QD JD 10S 9S 8S 10D 9D'),
    ];
  }
  /** Scripted dealer: returns each deal in turn, repeating the last. */
  function dealer(...deals: Card[][][]) {
    let i = 0;
    return () => deals[Math.min(i++, deals.length - 1)];
  }

  it('scores A 4, K 3, Q 2, J 1, plus 1 per card past the fourth in a suit', () => {
    expect(handPoints(cards('AS KS QS JS 2H 3H 4H 2C 3C 4C 2D 3D 4D'))).toBe(10);
    // Six spades: two length points. Five hearts: one.
    expect(handPoints(cards('2S 3S 4S 5S 6S 7S 2H 3H 4H 5H 6H 2C 2D'))).toBe(3);
    expect(handPoints(RANKS.map(rank => ({ suit: 'Spades' as Suit, rank })))).toBe(10 + 9);
    expect(weakSouthDeal().map(handPoints)).toEqual([1, 9 + 2, 10 + 3, 20 + 2]);
  });

  it('is on by default at 4 points', () => {
    expect(DEFAULT_RULES.wash).toBe(true);
    expect(DEFAULT_RULES.washMinPoints).toBe(4);
  });

  it('washes a deal where any hand is below the minimum, and redeals', () => {
    expect(isWash(weakSouthDeal(), DEFAULT_RULES)).toBe(true);
    expect(isWash(mixedHands(), DEFAULT_RULES)).toBe(false);
    const s = createInitialState(0, DEFAULT_RULES, dealer(weakSouthDeal(), weakSouthDeal(), mixedHands()));
    expect(s.washes).toBe(2);
    expect(s.hands).toEqual(createStateFromHands(mixedHands()).hands);
  });

  it('a hand exactly at the minimum is playable; the minimum is adjustable', () => {
    expect(isWash(weakSouthDeal(), { ...DEFAULT_RULES, washMinPoints: 1 })).toBe(false);
    expect(isWash(weakSouthDeal(), { ...DEFAULT_RULES, washMinPoints: 2 })).toBe(true);
    expect(isWash(mixedHands(), { ...DEFAULT_RULES, washMinPoints: 10 })).toBe(true);
  });

  it('with wash off, a weak deal is played', () => {
    const s = createInitialState(0, { ...DEFAULT_RULES, wash: false }, dealer(weakSouthDeal(), mixedHands()));
    expect(s.washes).toBe(0);
    expect(handPoints(s.hands[0])).toBe(1);
  });

  it('stops redealing at the cap rather than hanging', () => {
    const s = createInitialState(0, DEFAULT_RULES, dealer(weakSouthDeal()));
    expect(s.washes).toBe(MAX_WASHES);
  });

  it('random deals honour the minimum', () => {
    const rules = { ...DEFAULT_RULES, washMinPoints: 7 };
    for (let i = 0; i < 50; i++) {
      const s = createInitialState(0, rules);
      expect(Math.min(...s.hands.map(handPoints))).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('Constants', () => {
  it('SUITS and RANKS cover the deck', () => {
    expect(SUITS).toHaveLength(4);
    expect(RANKS).toHaveLength(13);
  });
});
