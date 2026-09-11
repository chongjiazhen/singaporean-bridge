import type { Card, PlayerIndex, Suit, Trick } from './types';
import { RANK_ORDER, SUIT_SYMBOLS, PLAYER_NAMES, cardToString } from './types';

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

export type WastedReason = 'not-led-suit' | 'not-trump';

export interface TrickVerdict {
  winner: PlayerIndex;
  winningCard: Card;
  /** 'trump': the only trump, beat the led suit. 'highest-trump': beat other trumps. 'led-suit': highest card of the led suit, no trumps played. */
  reason: 'trump' | 'highest-trump' | 'led-suit';
  /** Losing cards whose rank outranks the winner's rank, with why they could not win. */
  wasted: Array<{ player: PlayerIndex; card: Card; why: WastedReason }>;
}

/** null unless the trick is complete (4 cards) with a winner. */
export function explainTrick(trick: Trick): TrickVerdict | null {
  if (trick.cards.length !== 4 || trick.winner === null || trick.ledSuit === null) return null;

  const winnerEntry = trick.cards.find(c => c.player === trick.winner);
  if (!winnerEntry) return null;
  const winningCard = winnerEntry.card;
  const trumpSuit = trick.trumpSuit;
  const ledSuit = trick.ledSuit;

  const winnerIsTrump = trumpSuit !== null && winningCard.suit === trumpSuit;
  const otherTrumpsPlayed = winnerIsTrump
    ? trick.cards.some(c => c.player !== trick.winner && c.card.suit === trumpSuit)
    : false;

  const reason: TrickVerdict['reason'] = winnerIsTrump
    ? (otherTrumpsPlayed ? 'highest-trump' : 'trump')
    : 'led-suit';

  const wasted: TrickVerdict['wasted'] = [];
  for (const entry of trick.cards) {
    if (entry.player === trick.winner) continue;
    if (RANK_ORDER[entry.card.rank] <= RANK_ORDER[winningCard.rank]) continue;

    if (winnerIsTrump) {
      if (entry.card.suit !== trumpSuit) {
        wasted.push({ player: entry.player, card: entry.card, why: 'not-trump' });
      }
      // A higher-ranked trump can't lose to a lower trump - no third case.
    } else {
      if (entry.card.suit !== ledSuit) {
        wasted.push({ player: entry.player, card: entry.card, why: 'not-led-suit' });
      }
      // A higher-ranked led-suit card can't lose when no trumps were played - not reachable.
    }
  }

  return { winner: trick.winner, winningCard, reason, wasted };
}

const REASON_TEXT: Record<TrickVerdict['reason'], (ledSuit: Suit) => string> = {
  trump: ledSuit => `trump beats the led suit ${SUIT_SYMBOLS[ledSuit]}`,
  'highest-trump': () => 'highest trump',
  'led-suit': () => 'highest card of the led suit',
};

const WASTED_TEXT: Record<WastedReason, string> = {
  'not-led-suit': 'not the led suit',
  'not-trump': 'not trump',
};

/** One sentence for the table describing who won the trick and why, plus any wasted higher cards. */
export function trickVerdictText(trick: Trick): string | null {
  const verdict = explainTrick(trick);
  if (!verdict || trick.ledSuit === null) return null;

  let text = `${PLAYER_NAMES[verdict.winner]} wins with ${cardToString(verdict.winningCard)} - ${REASON_TEXT[verdict.reason](trick.ledSuit)}.`;

  for (const w of verdict.wasted) {
    text += ` ${PLAYER_NAMES[w.player]}'s ${cardToString(w.card)} could not win: ${WASTED_TEXT[w.why]}.`;
  }

  return text;
}
