import type { Card, Suit } from './types';
import { RANK_ORDER } from './types';

/**
 * Compare two cards within a trick. Positive when `a` beats `b`.
 * `trumpSuit` is null in a no-trump contract.
 */
export function compareCardsInTrick(
  a: Card,
  b: Card,
  ledSuit: Suit,
  trumpSuit: Suit | null
): number {
  const aIsTrump = trumpSuit !== null && a.suit === trumpSuit;
  const bIsTrump = trumpSuit !== null && b.suit === trumpSuit;

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

  // Both led suit, or both discards (neither can win): compare ranks for determinism
  return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}
