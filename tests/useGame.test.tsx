// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Card, GameState, PlayerIndex } from '../src/engine/types';
import { DEFAULT_RULES, getLegalBids } from '../src/engine/types';
import { createInitialState, startAuction } from '../src/engine/gameEngine';
import type { TransportBroker } from '../src/network/transport';
import { InMemoryBroker } from '../src/network/transport';
import { useGame } from '../src/hooks/useGame';

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A peer-mode harness. It reads the seat-gated values out of the hook onto data
 * attributes so assertions can read the rendered output directly.
 */
function PeerHarness({ broker }: { broker: TransportBroker }) {
  const g = useGame({ roomKey: 'test-room', isHost: false, broker });
  return (
    <div>
      <span data-testid="isHumanTurn">{String(g.isHumanTurn)}</span>
      <span data-testid="legalBids">{g.legalBids.length}</span>
      <span data-testid="legalPlays">{g.legalPlays.length}</span>
      <span data-testid="canPass">{String(g.canPass)}</span>
    </div>
  );
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

/** Auction snapshot with the given seat to bid; currentBid null => 30 legal bids. */
function auctionState(currentPlayer: PlayerIndex): GameState {
  return { ...startAuction(createInitialState(0, DEFAULT_RULES)), currentPlayer };
}

/**
 * Trick-play snapshot where the given seat leads (no led suit), so every card in
 * the hand is legal. Only the leading seat's hand is non-empty.
 */
function leadingTrickState(seat: PlayerIndex): GameState {
  const base = startAuction(createInitialState(0, DEFAULT_RULES));
  return {
    ...base,
    phase: 'TRICK_PLAY',
    currentPlayer: seat,
    hands: [undefined as unknown as Card[], base.hands[1], base.hands[2], base.hands[3]],
    tricks: {
      ...base.tricks,
      current: { cards: [], leader: seat, ledSuit: null, winner: null },
    },
  };
}

/**
 * Seat the peer, feed one snapshot, and return the hook's rendered values.
 *
 * The hook creates the transport inside a useEffect, which React flushes at the
 * end of the act body (after inner awaits). So mount in one act, let the broker
 * connect chain register its handlers on the next tick, then seat the peer and
 * feed the snapshot in their own acts.
 */
async function runWithSeat(seat: PlayerIndex, snapshot: GameState) {
  const broker = new InMemoryBroker();
  const captured: Record<string, string> = {};

  await act(async () => {
    root.render(<PeerHarness broker={broker} />);
  });
  await tick();

  await act(async () => {
    broker.__emitPeerReady(seat);
    await tick();
  });
  await act(async () => {
    broker.__emitInbound('host', { type: 'GAME_STATE', data: snapshot });
    await tick();
  });

  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
  for (const id of ['isHumanTurn', 'legalBids', 'legalPlays', 'canPass']) {
    captured[id] = q(id);
  }
  return captured;
}

describe('useGame - peer mode turn gating', () => {
  it('treats the peer as on turn only when the state currentPlayer equals the peer seat', async () => {
    const captured = await runWithSeat(2 as PlayerIndex, auctionState(2));
    expect(captured.isHumanTurn).toBe('true');
    expect(Number(captured.legalBids)).toBe(getLegalBids(null, 2).length);
    expect(Number(captured.legalBids)).toBeGreaterThan(0);

    // Same peer, but it is seat 0's turn now. A hardcoded-seat-0 query would
    // wrongly report the peer as on turn; the seat-aware query does not.
    const other = await runWithSeat(2 as PlayerIndex, auctionState(0));
    expect(other.isHumanTurn).toBe('false');
    expect(Number(other.legalBids)).toBe(0);
  });

  it('gates legalPlays on the peer seat, not on seat 0', async () => {
    const captured = await runWithSeat(3 as PlayerIndex, leadingTrickState(3));
    // Seat 0's hand is empty, so a hardcoded-seat-0 query yields nothing here,
    // while the seat-aware query returns the peer's (leading) hand.
    expect(Number(captured.legalPlays)).toBeGreaterThan(0);
    expect(captured.isHumanTurn).toBe('true');
  });

  it('canPass reflects the peer seat, not seat 0', async () => {
    // Fresh auction: seat 1 is the first bidder, so the peer on seat 2 (also
    // the current bidder) is not the opener and may pass. A seat-0 query would
    // instead ask whether seat 0 (the opener) can pass -> false.
    const captured = await runWithSeat(2 as PlayerIndex, auctionState(2));
    expect(captured.canPass).toBe('true');
    expect(captured.isHumanTurn).toBe('true');
  });
});
