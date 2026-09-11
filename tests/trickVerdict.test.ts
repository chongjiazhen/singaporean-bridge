import { describe, it, expect } from 'vitest';
import type { Card, PlayerIndex, Rank, Suit, Trick } from '../src/engine/types';
import { explainTrick, trickVerdictText } from '../src/engine/trickEvaluator';

/** Parse "AS KH 10D ..." into cards. */
function cards(spec: string): Card[] {
  const suitOf: Record<string, Suit> = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
  return spec.trim().split(/\s+/).map(tok => ({
    rank: tok.slice(0, -1) as Rank,
    suit: suitOf[tok.slice(-1)],
  }));
}

/** Build a Trick from "player:card" tokens, e.g. "0:9S 1:AH 2:KS 3:2S". */
function trick(spec: string, opts: { trumpSuit: Suit | null; winner: PlayerIndex | null }): Trick {
  const entries = spec.trim().split(/\s+/).map(tok => {
    const [playerStr, cardStr] = tok.split(':');
    return { player: Number(playerStr) as PlayerIndex, card: cards(cardStr)[0] };
  });
  return {
    cards: entries,
    leader: entries[0].player,
    winner: opts.winner,
    ledSuit: entries[0].card.suit,
    trumpSuit: opts.trumpSuit,
  };
}

describe('explainTrick', () => {
  it('led-suit winner with no wasted cards', () => {
    const t = trick('0:9S 1:2S 2:AS 3:KS', { trumpSuit: null, winner: 2 });
    const v = explainTrick(t);
    expect(v).not.toBeNull();
    expect(v!.winner).toBe(2);
    expect(v!.winningCard).toEqual({ suit: 'Spades', rank: 'A' });
    expect(v!.reason).toBe('led-suit');
    expect(v!.wasted).toEqual([]);
  });

  it('led-suit winner with a wasted off-suit ace', () => {
    // South leads 9S, West discards AH (off-suit, higher rank, still loses), North plays KS (wins), East plays 2S.
    const t = trick('0:9S 1:AH 2:KS 3:2S', { trumpSuit: null, winner: 2 });
    const v = explainTrick(t)!;
    expect(v.winner).toBe(2);
    expect(v.winningCard).toEqual({ suit: 'Spades', rank: 'K' });
    expect(v.reason).toBe('led-suit');
    expect(v.wasted).toEqual([{ player: 1, card: { suit: 'Hearts', rank: 'A' }, why: 'not-led-suit' }]);
  });

  it('single trump beats a led-suit ace', () => {
    // South leads AS, West discards a trump 2H, North and East follow with lower spades.
    // The winning 2H outranks nothing, so every other (non-trump) card is wasted.
    const t = trick('0:AS 1:2H 2:KS 3:QS', { trumpSuit: 'Hearts', winner: 1 });
    const v = explainTrick(t)!;
    expect(v.winner).toBe(1);
    expect(v.winningCard).toEqual({ suit: 'Hearts', rank: '2' });
    expect(v.reason).toBe('trump');
    expect(v.wasted).toEqual([
      { player: 0, card: { suit: 'Spades', rank: 'A' }, why: 'not-trump' },
      { player: 2, card: { suit: 'Spades', rank: 'K' }, why: 'not-trump' },
      { player: 3, card: { suit: 'Spades', rank: 'Q' }, why: 'not-trump' },
    ]);
  });

  it('two trumps -> highest-trump, losing higher non-trump ace wasted', () => {
    // South leads 9S, West discards AC (off-suit, higher rank), North trumps with 5H, East trumps higher with KH.
    const t = trick('0:9S 1:AC 2:5H 3:KH', { trumpSuit: 'Hearts', winner: 3 });
    const v = explainTrick(t)!;
    expect(v.winner).toBe(3);
    expect(v.winningCard).toEqual({ suit: 'Hearts', rank: 'K' });
    expect(v.reason).toBe('highest-trump');
    expect(v.wasted).toEqual([{ player: 1, card: { suit: 'Clubs', rank: 'A' }, why: 'not-trump' }]);
  });

  it('no-trump contract never yields "trump"', () => {
    const t = trick('0:AS 1:2H 2:KS 3:QS', { trumpSuit: null, winner: 0 });
    const v = explainTrick(t)!;
    expect(v.reason).not.toBe('trump');
    expect(v.reason).not.toBe('highest-trump');
    expect(v.reason).toBe('led-suit');
  });

  it('incomplete trick -> null', () => {
    const t: Trick = {
      cards: [
        { player: 0, card: { suit: 'Spades', rank: '9' } },
        { player: 1, card: { suit: 'Hearts', rank: 'A' } },
      ],
      leader: 0,
      winner: null,
      ledSuit: 'Spades',
      trumpSuit: null,
    };
    expect(explainTrick(t)).toBeNull();
  });
});

describe('trickVerdictText', () => {
  it('renders the led-suit-win sentence', () => {
    const t = trick('0:9S 1:2S 2:KS 3:QS', { trumpSuit: null, winner: 2 });
    expect(trickVerdictText(t)).toBe('North wins with K♠ - highest card of the led suit.');
  });

  it('renders the trump-win sentence with wasted cards appended', () => {
    const t = trick('0:AS 1:2H 2:KS 3:QS', { trumpSuit: 'Hearts', winner: 1 });
    expect(trickVerdictText(t)).toBe(
      "West wins with 2♥ - trump beats the led suit ♠." +
        " South's A♠ could not win: not trump." +
        " North's K♠ could not win: not trump." +
        " East's Q♠ could not win: not trump."
    );
  });

  it('returns null for an incomplete trick', () => {
    const t: Trick = {
      cards: [{ player: 0, card: { suit: 'Spades', rank: '9' } }],
      leader: 0,
      winner: null,
      ledSuit: 'Spades',
      trumpSuit: null,
    };
    expect(trickVerdictText(t)).toBeNull();
  });
});
