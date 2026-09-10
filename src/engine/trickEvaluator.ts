import type { Card, Suit } from './types';
import { RANK_ORDER } from './types';

export function compareCardsInTrick(
  a: Card,
  b: Card,
  ledSuit: Suit,
  trumpSuit: Suit
): number {
  const aIsTrump = a.suit === trumpSuit;
  const bIsTrump = b.suit === trumpSuit;

  // 1. Trump beats non-trump
  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  // 2. Both are trumps - compare ranks
  if (aIsTrump && bIsTrump) {
    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  }

  // 3. Neither is trump
  const aIsLed = a.suit === ledSuit;
  const bIsLed = b.suit === ledSuit;

  // Led suit beats non-led suit
  if (aIsLed && !bIsLed) return 1;
  if (!aIsLed && bIsLed) return -1;

  // Both are led suit - compare ranks
  if (aIsLed && bIsLed) {
    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  }

  // Neither is trump nor led suit - rank doesn't matter, neither can win against led suit,
  // but to be deterministic, return rank difference
  return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}