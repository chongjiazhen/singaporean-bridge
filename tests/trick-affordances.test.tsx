// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GameTable } from '../src/components/GameTable';
import type { Card, GameState, PlayerIndex } from '../src/engine/types';
import { DEFAULT_RULES } from '../src/engine/types';
import { createInitialState, startAuction, makeBid, pass, callPartner } from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';

/** Auction + partner call driven by the AI, stopped the moment trick play opens. */
function atTrickPlay(): GameState {
  let s = startAuction(createInitialState(0, DEFAULT_RULES));
  let guard = 0;
  while (s.phase !== 'TRICK_PLAY' && guard++ < 200) {
    const p = s.currentPlayer as PlayerIndex;
    const d = makeAiDecision(s, p);
    if (d.action === 'bid') s = makeBid(s, p, d.bid!.level, d.bid!.strain);
    else if (d.action === 'pass') s = pass(s, p);
    else if (d.action === 'call') s = callPartner(s, p, d.card!);
    else break;
  }
  return s;
}

const SPADE_LED: Card = { suit: 'Spades', rank: '9' };
const HUMAN_HAND: Card[] = [
  { suit: 'Spades', rank: 'K' },
  { suit: 'Spades', rank: '3' },
  { suit: 'Hearts', rank: 'A' },
  { suit: 'Diamonds', rank: '7' },
];
/** Spades were led and South holds spades, so only spades are legal. */
const LEGAL: Card[] = HUMAN_HAND.filter(c => c.suit === 'Spades');

/** West has led 9S; it is South's turn, mid-trick. */
function southToFollow(): GameState {
  const s = atTrickPlay();
  expect(s.phase).toBe('TRICK_PLAY');
  return {
    ...s,
    currentPlayer: 0,
    hands: [HUMAN_HAND, s.hands[1], s.hands[2], s.hands[3]] as GameState['hands'],
    tricks: {
      ...s.tricks,
      current: {
        cards: [{ player: 1, card: SPADE_LED }],
        leader: 1,
        winner: null,
        ledSuit: 'Spades',
        trumpSuit: s.contract?.trumpSuit ?? null,
      },
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(state: GameState, overrides: Partial<Parameters<typeof GameTable>[0]> = {}) {
  const noop = () => {};
  act(() => {
    root.render(
      <GameTable
        state={state}
        rules={state.rules}
        humanHand={HUMAN_HAND}
        legalPlays={LEGAL}
        availableCallCards={[]}
        legalBids={[]}
        canPass={false}
        statusText=""
        isHumanTurn={true}
        onBid={noop}
        onPass={noop}
        onCallCard={noop}
        onPlayCard={noop}
        onOpenTutorial={noop}
        onCloseTutorial={noop}
        onNewHand={noop}
        onSetRules={noop}
        showTutorial={false}
        pauseAfterTrick={true}
        awaitingContinue={false}
        onSetPauseAfterTrick={noop}
        onContinue={noop}
        {...overrides}
      />,
    );
  });
}

describe('Trick-play affordances', () => {
  it('tells the player to follow the led suit', () => {
    render(southToFollow());
    expect(container.textContent).toContain('was led - you must follow with a');
  });

  it('dims the cards that cannot legally be played', () => {
    render(southToFollow());
    const dimmed = Array.from(container.querySelectorAll('.opacity-40'));
    // The two off-suit cards (A hearts, 7 diamonds) are dimmed; the two spades are not.
    expect(dimmed).toHaveLength(2);
    const text = dimmed.map(el => el.textContent ?? '').join(' ');
    expect(text).toContain('A');
    expect(text).toContain('7');
  });

  it('offers a Next trick button while a finished trick is held, and continues on click', () => {
    let continued = 0;
    render(southToFollow(), { awaitingContinue: true, legalPlays: [], onContinue: () => { continued++; } });
    const button = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').includes('Next trick'));
    expect(button).toBeDefined();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(continued).toBe(1);
  });
});
