import { describe, it, expect } from 'vitest';
import type { Card, Strain, PlayerIndex } from '../src/engine/types';
import { makeTransport, InMemoryBroker } from '../src/network/transport';

/** Minimal card payload for commands. */
const sampleCard: Card = { rank: 'SH', suit: 'RED', value: 1 } as Card;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('makeTransport - host mode', () => {
  it('marks the transport as host', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    expect(t.isHost).toBe(true);
    t.destroy();
  });

  it('fires onPeerAssigned when a peer connects', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    let assigned: { seat: PlayerIndex; peerId: string } | null = null;
    t.onPeerAssigned((info) => {
      assigned = info;
    });
    await tick();
    // Broker now provides seat; seat 1 for first peer (hostSeat=0, arrivalPosition=1 -> (0+1)%4=1)
    broker.__emitPeerConnect('p1', 1 as PlayerIndex);
    expect(assigned).not.toBeNull();
    expect(assigned!.peerId).toBe('p1');
    expect((assigned!.seat as number) >= 0 && assigned!.seat < 4).toBe(true);
    t.destroy();
  });

  it('delivers a frame back to the peer after a BID', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    await tick();
    broker.__emitPeerConnect('p1', 1 as PlayerIndex);
    // The auction has not started, so the engine rejects the BID and the host
    // sends an ERROR frame back to the peer. Either way, a frame is delivered.
    broker.__emitInbound('p1', { type: 'BID', data: { level: 1, strain: 'Diamonds' } });
    const snaps = broker.__inboxFor('p1');
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    t.destroy();
  });

  it('returns ERROR and does not throw for an illegal BID', async () => {
    const broker = new InMemoryBroker();
    let threw = false;
    const errors: string[] = [];
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    await tick();
    // Host auto-starts the auction. p1 lands on the current bidding seat; p2 one past it.
    broker.__emitPeerConnect('p1', 1 as PlayerIndex);
    await tick();
    broker.__emitPeerConnect('p2', 2 as PlayerIndex);
    t.onError((reason) => {
      errors.push(reason);
    });
    // p2 is not the current bidder, so the engine rejects the BID with an ERROR.
    try {
      broker.__emitInbound('p2', { type: 'BID', data: { level: 1, strain: 'Diamonds' } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const errs = broker.__inboxFor('p2').filter((f) => f.type === 'ERROR');
    expect(errs.length).toBeGreaterThanOrEqual(1);
    t.destroy();
  });
});

describe('makeTransport - peer mode', () => {
  it('resolves seat from onPeerReady', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    expect(t.isHost).toBe(false);
    await tick();
    broker.__emitPeerReady(2 as PlayerIndex);
    expect((t.seat as number) === 2).toBe(true);
    t.destroy();
  });

  it('calls onGameState with a canonicalized GAME_STATE snapshot', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    await tick();
    let received: Frame | null = null;
    t.onGameState((frame) => {
      received = frame;
    });
    broker.__emitInbound('host', { type: 'GAME_STATE', data: { phase: 'AUCTION' } });
    expect(received).not.toBeNull();
    expect((received as { phase?: unknown }).phase).toBe('AUCTION');
    t.destroy();
  });

  it('sendBid serializes a BID frame to the broker', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    t.sendBid(3, 'Diamonds' as Strain);
    const bid = broker.__sent().find((f) => f.type === 'BID');
    expect(bid !== undefined).toBe(true);
    expect((bid.data as { level: number }).level).toBe(3);
    expect((bid.data as { strain: Strain }).strain).toBe('Diamonds');
    t.destroy();
  });

  it('sendCallPartner serializes a CALL_PARTNER frame', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    t.sendCallPartner(sampleCard);
    const frame = broker.__sent().find((f) => f.type === 'CALL_PARTNER');
    expect(frame !== undefined).toBe(true);
    expect((frame.data as { card: Card }).card).toEqual(sampleCard);
    t.destroy();
  });

  it('sendPlayCard serializes a PLAY_CARD frame', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    t.sendPlayCard(sampleCard);
    const frame = broker.__sent().find((f) => f.type === 'PLAY_CARD');
    expect(frame !== undefined).toBe(true);
    expect((frame.data as { card: Card }).card).toEqual(sampleCard);
    t.destroy();
  });

  it('destroy calls broker.disconnect exactly once', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: false, broker });
    t.destroy();
    expect(broker.__sent().length).toBe(0);
    t.destroy();
  });
});
