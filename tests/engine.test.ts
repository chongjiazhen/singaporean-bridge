import { describe, it, expect } from 'vitest';
import {
  createDeck, dealCards, compareBids, getLegalBids,
  isHigherBid, createCard, sortHand, SUIT_ORDER
} from '../src/engine/types';
import {
  createInitialState, startAuction, makeBid, pass,
  callPartner, playCard, getLegalPlays
} from '../src/engine/gameEngine';
import { compareCardsInTrick } from '../src/engine/trickEvaluator';

describe('Deck and Deal Invariants', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const set = new Set(deck.map(c => `${c.rank}-${c.suit}`));
    expect(set.size).toBe(52);
  });

  it('deals 13 unique cards to 4 players with no overlap', () => {
    const deck = createDeck();
    const hands = dealCards(deck);
    expect(hands).toHaveLength(4);

    const allCards = new Set<string>();
    hands.forEach(hand => {
      expect(hand).toHaveLength(13);
      hand.forEach(c => allCards.add(`${c.rank}-${c.suit}`));
    });
    expect(allCards.size).toBe(52);
  });
});

describe('Auction Mechanics', () => {
  it('enforces lexicographical bid comparison (trick target -> suit rank)', () => {
    const bid5D = { player: 0, tricks: 5, suit: 'Diamonds' as const };
    const bid5C = { player: 1, tricks: 5, suit: 'Clubs' as const };
    const bid5H = { player: 2, tricks: 5, suit: 'Hearts' as const };
    const bid5S = { player: 3, tricks: 0, suit: 'Spades' as const }; // target 5
    const bid5Spades = { player: 3, tricks: 5, suit: 'Spades' as const };
    const bid6D = { player: 0, tricks: 6, suit: 'Diamonds' as const };

    expect(compareBids(bid5C, bid5D)).toBeGreaterThan(0); // 5 Clubs > 5 Diamonds
    expect(compareBids(bid5H, bid5C)).toBeGreaterThan(0); // 5 Hearts > 5 Clubs
    expect(compareBids(bid5Spades, bid5H)).toBeGreaterThan(0); // 5 Spades > 5 Hearts
    expect(compareBids(bid6D, bid5Spades)).toBeGreaterThan(0); // 6 Diamonds > 5 Spades
  });

  it('prevents first bidder from passing', () => {
    let state = createInitialState(0);
    state = startAuction(state);
    expect(() => pass(state, 1)).toThrow('First player cannot pass');
  });

  it('correctly concludes auction when only 1 active bidder remains', () => {
    let state = createInitialState(0); // dealer South(0), first bidder West(1)
    state = startAuction(state);
    console.log('After startAuction:', state.currentPlayer, state.auction.activePlayers);
    state = makeBid(state, 1, 5, 'Hearts'); // West bids 5 Hearts
    console.log('After makeBid:', state.currentPlayer, state.auction.activePlayers);
    state = pass(state, 2); // North passes
    console.log('After pass 2:', state.currentPlayer, state.auction.activePlayers, state.phase);
    state = pass(state, 3); // East passes
    console.log('After pass 3:', state.currentPlayer, state.auction.activePlayers, state.phase);
    state = pass(state, 0); // South passes
    console.log('After pass 0:', state.currentPlayer, state.auction.activePlayers, state.phase);

    expect(state.phase).toBe('PARTNER_CALL');
    expect(state.auction.declarer).toBe(1); // West
    expect(state.contract).toEqual({ tricksRequired: 5, trumpSuit: 'Hearts' });
  });
});

describe('Partner Call Mechanics', () => {
  it('prevents declarer from calling a card in their own hand', () => {
    let state = createInitialState(0);
    state = startAuction(state);
    state = makeBid(state, 1, 5, 'Spades');
    state = pass(state, 2);
    state = pass(state, 3);
    state = pass(state, 0); // West wins

    const cardInWestHand = state.hands[1][0];
    expect(() => callPartner(state, 1, cardInWestHand)).toThrow('Cannot call a card in your own hand');
  });

  it('correctly identifies partner and defenders', () => {
    let state = createInitialState(0);
    state = startAuction(state);
    state = makeBid(state, 1, 6, 'Clubs');
    state = pass(state, 2);
    state = pass(state, 3);
    state = pass(state, 0); // West(1) declarer

    // Pick a card not in West's hand
    const cardInNorthHand = state.hands[2][0];
    state = callPartner(state, 1, cardInNorthHand);

    expect(state.phase).toBe('TRICK_PLAY');
    expect(state.partnerships?.declarer).toBe(1);
    expect(state.partnerships?.partner).toBe(2);
    expect(state.partnerships?.defenders).toContain(0);
    expect(state.partnerships?.defenders).toContain(3);
  });
});

describe('Trick Evaluation Rules', () => {
  it('gives victory to higher trump when trumps are played', () => {
    const card1 = createCard('Hearts', '5'); // Led suit
    const card2 = createCard('Spades', '2'); // Trump 2
    const card3 = createCard('Spades', '10'); // Trump 10

    const comp1 = compareCardsInTrick(card2, card1, 'Hearts', 'Spades');
    expect(comp1).toBeGreaterThan(0); // Trump 2 beats non-trump Hearts 5

    const comp2 = compareCardsInTrick(card3, card2, 'Hearts', 'Spades');
    expect(comp2).toBeGreaterThan(0); // Trump 10 beats Trump 2
  });

  it('enforces following suit', () => {
    let state = createInitialState(0);
    state = startAuction(state);
    state = makeBid(state, 1, 5, 'Diamonds');
    state = pass(state, 2);
    state = pass(state, 3);
    state = pass(state, 0);

    const calledCard = state.hands[2][0];
    state = callPartner(state, 1, calledCard);

    // Leader is West's left -> North(2)
    const northHand = state.hands[2];
    const ledCard = northHand[0];
    state = playCard(state, 2, ledCard); // North leads

    // East(3) must follow suit if they have ledCard.suit
    const eastHand = state.hands[3];
    const sameSuitCard = eastHand.find(c => c.suit === ledCard.suit);
    const diffSuitCard = eastHand.find(c => c.suit !== ledCard.suit);

    if (sameSuitCard && diffSuitCard) {
      expect(() => playCard(state, 3, diffSuitCard)).toThrow('Must follow suit');
    }
  });
});