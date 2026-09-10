/** AI implementation for Singaporean Floating Bridge computer players */

import type { GameState, PlayerIndex, Card, Suit, Strain } from '../engine/types';
import {
  getLegalBids, findCardInHand, RANK_ORDER, SUITS, RANKS, BOOK
} from '../engine/types';
import { compareCardsInTrick } from '../engine/trickEvaluator';
import { getLegalPlays, getFirstBidder, getSideKnowledge } from '../engine/gameEngine';

/** Never bid above this level (9 tricks): the hand evaluation is too crude to justify more. */
export const MAX_AI_LEVEL = 3;

/** Rough tricks an unseen called partner adds to the declarer's own. */
const PARTNER_TRICKS = 3;

const HCP: Partial<Record<Card['rank'], number>> = { A: 4, K: 3, Q: 2, J: 1 };

export function makeAiDecision(state: GameState, player: PlayerIndex): {
  action: 'bid' | 'pass' | 'call' | 'play';
  bid?: { level: number; strain: Strain };
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

function suitCounts(hand: Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };
  for (const card of hand) counts[card.suit]++;
  return counts;
}

/**
 * Pick the AI's preferred strain and the highest level it is willing to reach.
 * Balanced hands with values go no trump; otherwise the best suit by length and honours.
 */
function evaluateHand(hand: Card[]): { strain: Strain; maxLevel: number } {
  const counts = suitCounts(hand);
  const hcp: Record<Suit, number> = { Spades: 0, Hearts: 0, Clubs: 0, Diamonds: 0 };
  for (const card of hand) hcp[card.suit] += HCP[card.rank] ?? 0;
  const totalHcp = SUITS.reduce((sum, s) => sum + hcp[s], 0);

  let bestSuit: Suit = 'Spades';
  let bestScore = -1;
  for (const suit of SUITS) {
    const score = counts[suit] * 2 + hcp[suit];
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }

  const balanced = SUITS.every(s => counts[s] >= 2) && SUITS.every(s => counts[s] <= 4);
  const noTrump = balanced && totalHcp >= 14;

  // Own tricks: trumps beyond the third are roughly one each; honours about a third of a trick per point.
  const ownTricks = noTrump
    ? totalHcp / 3
    : Math.max(0, counts[bestSuit] - 3) + totalHcp / 3;
  const sideTricks = Math.floor(ownTricks + PARTNER_TRICKS);
  const maxLevel = Math.min(MAX_AI_LEVEL, Math.max(0, sideTricks - BOOK));

  return { strain: noTrump ? 'NoTrump' : bestSuit, maxLevel };
}

function decideBid(state: GameState, player: PlayerIndex): {
  action: 'bid' | 'pass';
  bid?: { level: number; strain: Strain };
} {
  const { strain, maxLevel } = evaluateHand(state.hands[player]);
  const mustOpen = state.auction.bids.length === 0 && player === getFirstBidder(state);

  if (mustOpen) return { action: 'bid', bid: { level: 1, strain } };

  // Lowest legal bid in our strain that stays within what we think we can make.
  const comfortableBid = getLegalBids(state.auction.currentBid, player)
    .find(b => b.strain === strain && b.level <= maxLevel);

  if (comfortableBid) {
    return { action: 'bid', bid: { level: comfortableBid.level, strain: comfortableBid.strain } };
  }
  return { action: 'pass' };
}

function decideCalledCard(state: GameState, declarer: PlayerIndex): Card {
  const hand = state.hands[declarer];
  const trumpSuit = state.contract!.trumpSuit;
  const missing = (card: Card) => findCardInHand(hand, card) === -1;

  if (trumpSuit) {
    // Highest missing trump, then highest missing card in any other suit.
    for (const suit of [trumpSuit, ...SUITS.filter(s => s !== trumpSuit)]) {
      for (const rank of RANKS) {
        if (missing({ suit, rank })) return { suit, rank };
      }
    }
  } else {
    // No trump: highest missing card by rank, preferring our longest suits.
    const counts = suitCounts(hand);
    const byLength = [...SUITS].sort((a, b) => counts[b] - counts[a]);
    for (const rank of RANKS) {
      for (const suit of byLength) {
        if (missing({ suit, rank })) return { suit, rank };
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
