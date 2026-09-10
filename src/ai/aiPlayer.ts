/** AI implementation for Singaporean Floating Bridge computer players */

import type { GameState, PlayerIndex, Card, Suit } from '../engine/types';
import {
  getLegalBids, findCardInHand, RANK_ORDER, SUITS, RANKS
} from '../engine/types';
import { compareCardsInTrick } from '../engine/trickEvaluator';
import { getLegalPlays, getFirstBidder, getSideKnowledge } from '../engine/gameEngine';

/** Never bid above this many tricks: the hand evaluation is too crude to justify slams. */
const MAX_AI_TARGET = 8;

const HCP: Partial<Record<Card['rank'], number>> = { A: 4, K: 3, Q: 2, J: 1 };

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

function lowestOf(cards: Card[]): Card {
  return cards.reduce((lo, c) => (RANK_ORDER[c.rank] < RANK_ORDER[lo.rank] ? c : lo), cards[0]);
}

function highestOf(cards: Card[]): Card {
  return cards.reduce((hi, c) => (RANK_ORDER[c.rank] > RANK_ORDER[hi.rank] ? c : hi), cards[0]);
}

/**
 * Pick the AI's trump suit and a trick target for the whole hand:
 * trump length plus honours in the side suits, capped at MAX_AI_TARGET.
 */
function evaluateHand(hand: Card[]): { bestSuit: Suit; expectedTricks: number } {
  const suitCounts: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };
  const suitHcp: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };
  for (const card of hand) {
    suitCounts[card.suit]++;
    suitHcp[card.suit] += HCP[card.rank] ?? 0;
  }

  let bestSuit: Suit = 'Spades';
  let bestScore = -1;
  for (const suit of SUITS) {
    const score = suitCounts[suit] * 2 + suitHcp[suit];
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }

  // Trumps are worth roughly one trick each beyond the first three; side honours a third each.
  const trumpTricks = Math.max(0, suitCounts[bestSuit] - 3) + suitHcp[bestSuit] / 3;
  const sideHcp = SUITS.filter(s => s !== bestSuit).reduce((sum, s) => sum + suitHcp[s], 0);
  const raw = Math.floor(trumpTricks + sideHcp / 3);
  return { bestSuit, expectedTricks: Math.min(MAX_AI_TARGET, Math.max(1, raw)) };
}

function decideBid(state: GameState, player: PlayerIndex): {
  action: 'bid' | 'pass';
  bid?: { tricks: number; suit: Suit };
} {
  const { bestSuit, expectedTricks } = evaluateHand(state.hands[player]);
  const mustOpen = state.auction.bids.length === 0 && player === getFirstBidder(state);

  if (mustOpen) {
    return { action: 'bid', bid: { tricks: Math.min(expectedTricks, 4), suit: bestSuit } };
  }

  // Lowest legal bid in our best suit that stays within what we think we can make.
  const comfortableBid = getLegalBids(state.auction.currentBid, player)
    .find(b => b.suit === bestSuit && b.tricks <= expectedTricks);

  if (comfortableBid) {
    return { action: 'bid', bid: { tricks: comfortableBid.tricks, suit: comfortableBid.suit } };
  }
  return { action: 'pass' };
}

function decideCalledCard(state: GameState, declarer: PlayerIndex): Card {
  const hand = state.hands[declarer];
  const trumpSuit = state.contract!.trumpSuit;

  // Highest missing trump, then highest missing card in any other suit.
  const suitsToTry = [trumpSuit, ...SUITS.filter(s => s !== trumpSuit)];
  for (const suit of suitsToTry) {
    for (const rank of RANKS) {
      const card: Card = { suit, rank };
      if (findCardInHand(hand, card) === -1) return card;
    }
  }
  throw new Error('Could not find any card missing from hand');
}

function decideCardToPlay(state: GameState, player: PlayerIndex): Card {
  const legalPlays = getLegalPlays(state, player);
  if (legalPlays.length === 1) return legalPlays[0];

  const currentTrick = state.tricks.current!;
  const trumpSuit = state.contract!.trumpSuit;

  // Leading: an ace if we have one, else our highest card.
  if (currentTrick.cards.length === 0) {
    const ace = legalPlays.find(c => c.rank === 'A');
    return ace ?? highestOf(legalPlays);
  }

  const ledSuit = currentTrick.ledSuit!;
  const winner = currentTrick.winner!;

  // Only what this seat legitimately knows (matters under hidden-partner rules):
  // an unknown seat is treated as an opponent.
  const knowledge = getSideKnowledge(state, player);
  if (knowledge[winner] === 'ally') return lowestOf(legalPlays);

  // Try to win cheaply.
  const winningCard = currentTrick.cards.find(c => c.player === winner)!.card;
  const winners = legalPlays.filter(c => compareCardsInTrick(c, winningCard, ledSuit, trumpSuit) > 0);
  if (winners.length > 0) return lowestOf(winners);

  // Can't win: throw the lowest card.
  return lowestOf(legalPlays);
}
