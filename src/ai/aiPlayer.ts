/** AI implementation for Singaporean Floating Bridge computer players */

import type { GameState, PlayerIndex, Card, Suit, Rank } from '../engine/types';
import {
  getLegalBids, findCardInHand, RANK_ORDER
} from '../engine/types';
import { compareCardsInTrick } from '../engine/trickEvaluator';
import { getLegalPlays } from '../engine/gameEngine';

export function makeAiDecision(state: GameState, player: PlayerIndex): {
  action: 'bid' | 'pass' | 'call' | 'play';
  bid?: { tricks: number; suit: Suit };
  card?: Card;
} {
  switch (state.phase) {
    case 'AUCTION':
      return decideBid(state, player);
    case 'PARTNER_CALL':
      return { action: 'call', card: decideCalledCard(state, player) };
    case 'TRICK_PLAY':
      return { action: 'play', card: decideCardToPlay(state, player) };
    default:
      throw new Error(`Invalid phase for AI decision: ${state.phase}`);
  }
}

function decideBid(state: GameState, player: PlayerIndex): {
  action: 'bid' | 'pass';
  bid?: { tricks: number; suit: Suit };
} {
  const hand = state.hands[player];
  const isFirstBid = state.auction.bids.length === 0 && player === (state.dealer + 1) % 4;

  // Evaluate hand strength per suit
  const suitCounts: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };
  const suitHighCards: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };

  for (const card of hand) {
    suitCounts[card.suit]++;
    if (card.rank === 'A') suitHighCards[card.suit] += 4;
    else if (card.rank === 'K') suitHighCards[card.suit] += 3;
    else if (card.rank === 'Q') suitHighCards[card.suit] += 2;
    else if (card.rank === 'J') suitHighCards[card.suit] += 1;
  }

  // Find best suit
  let bestSuit: Suit = 'Spades';
  let maxScore = -1;

  for (const suit of ['Spades', 'Hearts', 'Clubs', 'Diamonds'] as Suit[]) {
    // Score based on length and high cards
    const score = suitCounts[suit] * 2 + suitHighCards[suit];
    if (score > maxScore) {
      maxScore = score;
      bestSuit = suit;
    }
  }

  // Calculate realistic trick target (between 4 and 8)
  const expectedTricks = Math.min(13, Math.max(1, Math.floor(suitCounts[bestSuit] + suitHighCards[bestSuit] / 3)));

  const currentBid = state.auction.currentBid;

  if (isFirstBid) {
    // Must open!
    const openTricks = Math.max(1, Math.min(6, expectedTricks));
    return {
      action: 'bid',
      bid: { tricks: openTricks, suit: bestSuit },
    };
  }

  // Check if we can make a higher bid that we feel comfortable with
  if (!currentBid) {
    return {
      action: 'bid',
      bid: { tricks: Math.max(1, expectedTricks), suit: bestSuit },
    };
  }

  // Generate legal higher bids
  const legalBids = getLegalBids(currentBid, player, false);

  // Find the lowest legal bid in our best suit, or any valid bid if reasonable
  const comfortableBid = legalBids.find(b => b.suit === bestSuit && b.tricks <= expectedTricks);

  if (comfortableBid) {
    return {
      action: 'bid',
      bid: { tricks: comfortableBid.tricks, suit: comfortableBid.suit },
    };
  }

  // Otherwise, pass if legal
  return { action: 'pass' };
}

function decideCalledCard(state: GameState, declarer: PlayerIndex): Card {
  const hand = state.hands[declarer];
  const trumpSuit = state.contract!.trumpSuit;

  // Heuristic: Call the highest missing card in the trump suit
  const ranksInOrder: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

  for (const rank of ranksInOrder) {
    const card: Card = { suit: trumpSuit, rank };
    if (findCardInHand(hand, card) === -1) {
      return card; // Found highest missing trump
    }
  }

  // Fallback if declarer holds ALL trumps: call highest missing off-suit card (e.g. Spades Ace)
  const otherSuits = (['Spades', 'Hearts', 'Clubs', 'Diamonds'] as Suit[]).filter(s => s !== trumpSuit);
  for (const suit of otherSuits) {
    for (const rank of ranksInOrder) {
      const card: Card = { suit, rank };
      if (findCardInHand(hand, card) === -1) {
        return card;
      }
    }
  }

  throw new Error('Could not find any card missing from hand');
}

function decideCardToPlay(state: GameState, player: PlayerIndex): Card {
  const legalPlays = getLegalPlays(state, player);
  if (legalPlays.length === 1) return legalPlays[0];

  const currentTrick = state.tricks.current!;
  const trumpSuit = state.contract!.trumpSuit;

  // Leading
  if (!currentTrick.ledSuit || currentTrick.cards.length === 0) {
    // Prefer playing high cards (Aces/Kings) or trumps
    const aces = legalPlays.filter((c: Card) => c.rank === 'A');
    if (aces.length > 0) return aces[0];

    // Otherwise play highest card
    return legalPlays.reduce((highest: Card, card: Card) =>
      RANK_ORDER[card.rank] > RANK_ORDER[highest.rank] ? card : highest
    , legalPlays[0]);
  }

  // Following suit or sluffing/trumping
  const ledSuit = currentTrick.ledSuit;

  // If partner is currently winning the trick, play low
  const isPartnerWinning = state.partnerships && (
    (state.partnerships.declarer === player && currentTrick.winner === state.partnerships.partner) ||
    (state.partnerships.partner === player && currentTrick.winner === state.partnerships.declarer) ||
    (state.partnerships.defenders.includes(player) && state.partnerships.defenders.includes(currentTrick.winner!))
  );

  if (isPartnerWinning) {
    // Play lowest legal card
    return legalPlays.reduce((lowest: Card, card: Card) =>
      RANK_ORDER[card.rank] < RANK_ORDER[lowest.rank] ? card : lowest
    , legalPlays[0]);
  }

  // Try to win the trick if possible
  const currentWinningCard = currentTrick.cards.find(c => c.player === currentTrick.winner!)?.card;

  if (currentWinningCard) {
    const winningCandidates = legalPlays.filter((c: Card) =>
      compareCardsInTrick(c, currentWinningCard, ledSuit, trumpSuit) > 0
    );

    if (winningCandidates.length > 0) {
      // Play lowest winning candidate
      return winningCandidates.reduce((lowest: Card, card: Card) =>
        RANK_ORDER[card.rank] < RANK_ORDER[lowest.rank] ? card : lowest
      , winningCandidates[0]);
    }
  }

  // Can't win - play lowest legal card
  return legalPlays.reduce((lowest: Card, card: Card) =>
    RANK_ORDER[card.rank] < RANK_ORDER[lowest.rank] ? card : lowest
  , legalPlays[0]);
}