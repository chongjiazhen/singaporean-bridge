// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Card, GameState } from '../src/engine/types';
import { DEFAULT_RULES } from '../src/engine/types';
import {
  createInitialState, seededDeal, randomDeal, MAX_WASHES,
} from '../src/engine/gameEngine';
import { makeTransport, InMemoryBroker } from '../src/network/transport';
import type { Transport } from '../src/network/transport';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** True when two deals are byte-identical (same cards, same order, per seat). */
function equalHands(a: Card[][], b: Card[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((hand, seat) => JSON.stringify(hand) === JSON.stringify(b[seat]));
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

describe('seededDeal reproducibility', () => {
  it('seededDeal(42) produces byte-identical hands across independent closures', () => {
    const a = seededDeal(42)();
    const b = seededDeal(42)();
    expect(equalHands(a, b)).toBe(true);
  });

  it('the same seed yields the same 4 hands; a different seed yields different hands', () => {
    const d42a = seededDeal(42)();
    const d42b = seededDeal(42)();
    const d43 = seededDeal(43)();
    expect(equalHands(d42a, d42b)).toBe(true);
    expect(equalHands(d42a, d43)).toBe(false);
  });

  it('a fresh seeded deal is a valid 13-card-per-seat deal', () => {
    const hands = seededDeal(7)();
    expect(hands).toHaveLength(4);
    hands.forEach((hand) => expect(hand).toHaveLength(13));
  });
});

describe('single-stream-through-wash-loop (P1 hang guard)', () => {
  it('createInitialState with seededDeal(7) never spins to the wash cap', () => {
    // A single advancing rng stream feeds every deal() call in the wash loop, so
    // a washable deal is eventually replaced — never the same hand repeated.
    const state = createInitialState(0, DEFAULT_RULES, seededDeal(7));
    expect(state.washes).toBeLessThan(MAX_WASHES);
    expect(state.hands).toHaveLength(4);
    state.hands.forEach((hand) => expect(hand).toHaveLength(13));
  });

  it('every seed over a range completes without hitting the wash cap', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = createInitialState(0, DEFAULT_RULES, seededDeal(seed));
      expect(state.washes).toBeLessThan(MAX_WASHES);
    }
  });
});

describe('deterministic deal across the engine', () => {
  it('dealing twice with seed 99 yields equal hands', () => {
    const x = createInitialState(0, DEFAULT_RULES, seededDeal(99));
    const y = createInitialState(0, DEFAULT_RULES, seededDeal(99));
    expect(equalHands(x.hands, y.hands)).toBe(true);
  });

  it('the default randomDeal is not reproducible (true randomness preserved)', () => {
    const a = createInitialState(0, DEFAULT_RULES, randomDeal).hands;
    const b = createInitialState(0, DEFAULT_RULES, randomDeal).hands;
    expect(equalHands(a, b)).toBe(false);
  });
});

describe('transport-level seeded determinism', () => {
  /** Deal a hand by starting a host room that waits for peers, then startGame. */
  async function dealWithSeed(seed: number, broker: InMemoryBroker): Promise<GameState> {
    const host: Transport = await makeTransport({
      roomKey: `seed-room-${seed}`,
      isHost: true,
      hostSeat: 0,
      broker,
      waitForPeers: true,
      seed,
    });
    const states: GameState[] = [];
    host.onGameState((s) => states.push(s));
    await tick();
    act(() => { host.startGame(); });
    host.destroy();
    const dealt = states[states.length - 1];
    expect(dealt).toBeDefined();
    return dealt;
  }

  it('two host transports with the SAME seed deal identical hands', async () => {
    const a = await dealWithSeed(77, new InMemoryBroker());
    const b = await dealWithSeed(77, new InMemoryBroker());
    expect(equalHands(a.hands, b.hands)).toBe(true);
  });

  it('two host transports with DIFFERENT seeds deal different hands', async () => {
    const a = await dealWithSeed(1, new InMemoryBroker());
    const b = await dealWithSeed(2, new InMemoryBroker());
    expect(equalHands(a.hands, b.hands)).toBe(false);
  });

  it('a seeded host deal equals a direct seeded createInitialState (stream position match)', async () => {
    // The started hand is the SECOND draw from the seeded stream (first is the
    // suppressed DEALING placeholder). Mirror that: one wasted draw, then deal.
    const rng = seededDeal(77);
    rng(); // placeholder DEALING draw
    const started = await dealWithSeed(77, new InMemoryBroker());
    const expected = createInitialState(0, DEFAULT_RULES, rng);
    expect(equalHands(started.hands, expected.hands)).toBe(true);
  });
});
