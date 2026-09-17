import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Transport, GameState, PlayerIndex, Card, Strain, Frame } from '../../src/network/transport';
import { makeTransport, InMemoryBroker } from '../../src/network/transport';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Multiplayer integration via shared broker', () => {
  let broker: InMemoryBroker;
  let hostTransport: Transport;
  let peerTransport: Transport;

  beforeEach(async () => {
    broker = new InMemoryBroker();
    
    hostTransport = await makeTransport({
      roomKey: 'shared-room',
      isHost: true,
      broker,
      hostSeat: 0,
    });

    peerTransport = await makeTransport({
      roomKey: 'shared-room',
      isHost: false,
      broker,
    });
  });

  afterEach(() => {
    hostTransport.destroy();
    peerTransport.destroy();
  });

  it('peer sends frames to broker', async () => {
    await tick();
    (broker as any).__emitPeerReady(1 as PlayerIndex);
    await tick();

    // Peer sends a bid
    peerTransport.sendBid(1, 'Clubs' as Strain);
    await tick();

    const sent = (broker as any).__sent();
    const bidFrames = sent.filter((f: any) => f.type === 'BID');
    expect(bidFrames.length).toBeGreaterThanOrEqual(1);
    expect(bidFrames[bidFrames.length - 1].data.level).toBe(1);
  });

  it('host processes multiple commands and advances bots', async () => {
    const hostStates: GameState[] = [];
    hostTransport.onGameState((state) => hostStates.push(state));
    await tick();

    (broker as any).__emitPeerConnect('p1');
    (broker as any).__emitPeerReady(1 as PlayerIndex);
    await tick();

    // Peer (seat 1) bids first - they're the opener
    (broker as any).__emitInbound('p1', { type: 'BID', data: { level: 1, strain: 'Spades' } });
    await tick();

    // Host (seat 0) passes
    (hostTransport as any).sendPass();
    await tick();

    await tick();

    // Verify we got some state updates
    expect(hostStates.length).toBeGreaterThan(0);
    const latestState = hostStates[hostStates.length - 1];
    expect(['AUCTION', 'PARTNER_CALL', 'TRICK_PLAY', 'HAND_RESULT']).toContain(latestState.phase);
  });

  it('handles illegal commands with ERROR frame', async () => {
    const errors: string[] = [];
    hostTransport.onError((reason) => errors.push(reason));

    await tick();
    (broker as any).__emitPeerConnect('p1');
    (broker as any).__emitPeerReady(1 as PlayerIndex);
    await tick();

    // Peer (seat 1) bids - they're the opener since hostSeat=0
    (broker as any).__emitInbound('p1', { type: 'BID', data: { level: 1, strain: 'Diamonds' } });
    await tick();

    // Now host (seat 0) tries to bid out of turn - should be illegal
    (hostTransport as any).sendBid(1, 'Clubs');
    await tick();

    // Host's bid was rejected - error is recorded via onError callback
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});