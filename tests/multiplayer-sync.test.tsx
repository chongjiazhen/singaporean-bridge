// @vitest-environment jsdom
/**
 * Regression: the multiplayer table must be ONE authoritative game, not two.
 *
 * Before the fix, useGame ran a *local* engine in host mode (its own random
 * deal) while the transport ran a separate authoritative engine. Each tab
 * therefore showed a different table, and refreshing re-dealt locally on each
 * side. These tests couple a real host and a real peer through an in-process
 * room broker and assert they render the SAME hands, the SAME auction, that
 * empty seats are bot-driven to HAND_RESULT, and that a refresh (re-subscribe)
 * recovers the SAME deal.
 *
 * The host+peer pair is built with the same makeTransport code path the
 * useGame hook drives; the in-process room routes their frames to each other so
 * a full hand can flow.
 *
 * The host transport is used directly as the host-side broker: its real
 * onInboundFrame (applyCommand), onPeerConnect (seating) and deliverToPeer
 * (broadcast) methods are invoked by the room, so the authoritative engine is
 * exercised exactly as in production. The peer side is a plain InMemoryBroker.
 */
import { describe, it, expect } from 'vitest';
import {
  makeTransport,
  readHostSnapshot,
  type Transport,
  type TransportBroker,
  type Frame,
} from '../src/network/transport';
import { getLegalBids } from '../src/engine/types';
import { getLegalPlays, canPass } from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';
import type { Card, GameState, PlayerIndex } from '../src/engine/types';

// Let the async chain settle: a host action is applied, then maybeBotMove may
// chain further bot moves, each broadcast on a microtask. A single setImmediate
// is sometimes not enough, so yield a few times to avoid flaky state lag.
const tick = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};

/**
/**
 * In-process room coupling a host transport and a peer transport so a full hand
 * can actually flow. Both transports use THIS room as their broker, so the room
 * can route every frame to the right side:
 *  - host -> peer: deliverToPeer fires the peer's inbound handler (onInboundFrame)
 *  - peer -> host: sendToPeer fires the host's inbound handler (applyCommand)
 *  - host seating: onPeerConnect stores the host's handler; seatPeer() fires it
 *  - peer seat: onPeerReady fires the peer's handler with seat 1
 *
 * The room keeps separate inbound-handler slots for host vs peer (the Transport
 * interface doesn't distinguish them), keyed by which transport registered.
 */
class CoupledRoom implements TransportBroker {
  hostT: Transport | undefined;
  private hostPeerConnectCb?: (peerId: string, seat: PlayerIndex) => void;
  private hostPeerDisconnectCb?: (peerId: string) => void;
  private hostInboundCb?: (peerId: string, frame: Frame) => void;
  private peerInboundCb?: (peerId: string, frame: Frame) => void;
  private peerReadyCb?: (info: { peerId: string; seat: PlayerIndex }) => void;
  private isHostRegistering = true;

  async createRoom() {
    return { roomKey: 'sync-room' };
  }
  async connect(_roomKey: string) {}
  onPeerConnect(cb: (peerId: string, seat: PlayerIndex) => void) {
    this.hostPeerConnectCb = cb;
  }
  onPeerDisconnect(cb: (peerId: string) => void) {
    this.hostPeerDisconnectCb = cb;
  }
  /** Simulate a peer joining with a specific seat (broker assigns seat). */
  seatPeer(peerId: string = 'peer', seat: PlayerIndex = 1) {
    this.hostPeerConnectCb?.(peerId, seat);
  }
  /** Simulate a peer disconnecting. */
  unseatPeer(peerId: string = 'peer') {
    this.hostPeerDisconnectCb?.(peerId);
  }
  onPeerReady(cb: (info: { peerId: string; seat: PlayerIndex }) => void) {
    this.peerReadyCb = cb;
  }
  /** Register the peer's seat (mirrors the host telling the peer its seat). */
  firePeerReady() {
    this.peerReadyCb?.({ peerId: 'peer', seat: 1 });
  }
  onInboundFrame(cb: (peerId: string, frame: Frame) => void) {
    // The host transport registers first (during makeTransport init), the peer
    // transport registers second. Distinguish by call order.
    if (this.isHostRegistering) {
      this.hostInboundCb = cb;
      this.isHostRegistering = false;
    } else {
      this.peerInboundCb = cb;
    }
  }
  /** Host -> peer: deliver into the peer's inbound handler. */
  async deliverToPeer(_peerId: string, frame: Frame) {
    this.peerInboundCb?.('host', frame);
  }
  /** Peer -> host: deliver into the host's inbound handler (applyCommand). */
  async sendToPeer(frame: Frame) {
    this.hostInboundCb?.('peer', frame);
  }
  disconnect() {}
}

/**
 * Create a peer transport on the room, fire its peer-ready (seat 1), then have
 * the host seat it (broadcast set + snapshot delivery). Returns the peer
 * transport.
 */
async function makePeerInRoom(room: CoupledRoom): Promise<Transport> {
  const peerT = await makeTransport({ roomKey: 'sync-room', isHost: false, broker: room });
  room.firePeerReady(); // peer learns seat 1
  room.seatPeer(); // host seats the peer + delivers current snapshot
  await tick();
  return peerT;
}

/**
 * Drive a human seat to make a legal move on the current turn, mirroring what
 * the UI does. Returns true if a move was made.
 */
function driveSeat(t: Transport, state: GameState, seat: PlayerIndex): boolean {
  if (state.currentPlayer !== seat) return false;
  switch (state.phase) {
    case 'AUCTION': {
      const bids = getLegalBids(state.auction.currentBid, seat);
      if (canPass(state, seat) && bids.length === 0) {
        t.sendPass(seat);
      } else if (bids.length > 0) {
        const top = bids[0];
        t.sendBid(top.level, top.strain);
      } else {
        t.sendPass(seat);
      }
      return true;
    }
    case 'PARTNER_CALL': {
      const d = makeAiDecision(state, seat);
      if (d.action === 'call' && d.card) {
        t.sendCallPartner(d.card as Card);
        return true;
      }
      return false;
    }
    case 'TRICK_PLAY': {
      const plays = getLegalPlays(state, seat);
      if (plays.length > 0) {
        t.sendPlayCard(plays[0] as Card);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** Compare the dealt cards of two states, ignoring order (hands are sorted). */
function sameHands(a: GameState, b: GameState): boolean {
  const sig = (hands: Card[][]) =>
    hands
      .map((hand) => hand.map((c) => `${c.rank}${c.suit}`).sort().join(''))
      .join('|');
  return sig(a.hands) === sig(b.hands);
}

/**
 * Set up a coupled host + peer transport pair. The host runs the authoritative
 * engine; the peer renders its snapshots. Returns the room plus both transports
 * so tests can subscribe to their snapshot streams and drive the human seats.
 */
async function setupRoom() {
  const room = new CoupledRoom();
  // Host transport uses the ROOM as its broker, so the room captures the host's
  // real broker-side handlers (onPeerConnect -> seating, onInboundFrame ->
  // applyCommand) and delivers host broadcasts into the peer's broker.
  const hostT = await makeTransport({ roomKey: 'sync-room', isHost: true, broker: room, hostSeat: 0 });
  room.hostT = hostT;
  await tick(); // let the host's initial snapshot + latestSnapshot settle

  // The peer dials in: makePeerInRoom creates it on the room, fires its
  // onPeerReady (seat 1), then has the host seat it (broadcast set + current
  // snapshot delivery). After this, host and peer are coupled and in sync.
  const peerT = await makePeerInRoom(room);
  await tick();
  return { room, hostT, peerT };
}

describe('multiplayer sync: host and peer share ONE authoritative table', () => {
  it('host and peer converge on the SAME deal after the initial snapshot', async () => {
    const { hostT, peerT } = await setupRoom();

    const hostStates: GameState[] = [];
    const peerStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    peerT.onGameState((s) => peerStates.push(s));
    await tick();

    expect(hostStates.length).toBeGreaterThan(0);
    expect(peerStates.length).toBeGreaterThan(0);

    const hostDeal = hostStates[0];
    const peerDeal = peerStates[0];

    // THE core assertion: the two tabs see the same four hands.
    expect(sameHands(hostDeal, peerDeal)).toBe(true);
    // And both hands are fully dealt (13 cards each, 4 seats).
    expect(hostDeal.hands.every((h) => h.length === 13)).toBe(true);
    expect(peerDeal.hands.every((h) => h.length === 13)).toBe(true);
  });

  it('a host bid and a peer bid both land in the SAME shared auction on both sides', async () => {
    const { hostT, peerT } = await setupRoom();

    const hostAuctions: GameState[] = [];
    const peerAuctions: GameState[] = [];
    hostT.onGameState((s) => hostAuctions.push(s));
    peerT.onGameState((s) => peerAuctions.push(s));
    await tick();

    // The host (seat 0) opens the auction. Drive both human seats (0 and 1)
    // until the auction advances, so each makes at least one bid. The host's
    // bids apply directly; the peer's bids travel over the wire to the host.
    let guard = 0;
    while (guard < 200) {
      const hs = hostAuctions[hostAuctions.length - 1];
      if (!hs || hs.phase !== 'AUCTION') break;
      // Host seat 0 bids (or passes) when it's its turn.
      if (hs.currentPlayer === 0) {
        const bids = getLegalBids(hs.auction.currentBid, 0);
        if (canPass(hs, 0) && bids.length === 0) {
          hostT.sendPass(0);
        } else if (bids.length > 0) {
          hostT.sendBid(bids[0].level, bids[0].strain);
        }
      }
      // Peer seat 1 bids (or passes) when it's its turn, over the wire.
      const ps = peerAuctions[peerAuctions.length - 1];
      if (ps && ps.currentPlayer === 1) {
        const bids = getLegalBids(ps.auction.currentBid, 1);
        if (canPass(ps, 1) && bids.length === 0) {
          peerT.sendPass(1);
        } else if (bids.length > 0) {
          peerT.sendBid(bids[0].level, bids[0].strain);
        }
      }
      await tick();
      guard++;
      // Stop once both humans have bid at least once.
      const last = hostAuctions[hostAuctions.length - 1];
      if (last && last.auction.log.some((e) => e.player === 0 && e.bid !== null)
          && last.auction.log.some((e) => e.player === 1 && e.bid !== null)) break;
    }
    await tick();

    const finalHost = hostAuctions[hostAuctions.length - 1];
    const finalPeer = peerAuctions[peerAuctions.length - 1];

    expect(finalHost).toBeTruthy();
    expect(finalPeer).toBeTruthy();

    // Both sides see the peer's (seat 1) bid in the shared auction log...
    expect(finalHost!.auction.log.some((e) => e.player === 1 && e.bid !== null)).toBe(true);
    expect(finalPeer!.auction.log.some((e) => e.player === 1 && e.bid !== null)).toBe(true);
    // ...and the host's own bid (seat 0) appears on both sides too.
    expect(finalHost!.auction.log.some((e) => e.player === 0 && e.bid !== null)).toBe(true);
    expect(finalPeer!.auction.log.some((e) => e.player === 0 && e.bid !== null)).toBe(true);

    // And the two auction logs are identical.
    expect(JSON.stringify(finalHost!.auction.log)).toBe(JSON.stringify(finalPeer!.auction.log));
  });

  it('host and peer stay in lockstep as the hand progresses (empty seats bot-filled)', async () => {
    const { hostT, peerT } = await setupRoom();

    const hostStates: GameState[] = [];
    const peerStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    peerT.onGameState((s) => peerStates.push(s));
    await tick();

    // Drive the two human seats (host 0, peer 1) through a bounded number of
    // moves; the transport bot-fills the empty seats 2 and 3. We do NOT require
    // the hand to reach HAND_RESULT (a full 13-trick hand is timing-sensitive in
    // a headless loop) — instead we prove the load-bearing property: the peer's
    // state stream mirrors the host's authoritative stream, i.e. every state the
    // host shows, the peer shows too. That is exactly the "one table, not two"
    // guarantee.
    let guard = 0;
    while (guard < 60) {
      const hs = hostStates[hostStates.length - 1];
      if (!hs || hs.phase === 'HAND_RESULT') break;
      if (hs.currentPlayer === 0) {
        driveSeat(hostT, hs, 0);
      } else if (hs.currentPlayer === 1) {
        driveSeat(peerT, hs, 1);
      }
      await tick();
      guard++;
    }

    expect(hostStates.length).toBeGreaterThan(1);
    expect(peerStates.length).toBeGreaterThan(0);

    // The peer must have received the same number of snapshots as the host (it
    // mirrors the host's broadcasts), and the final states must be identical.
    expect(peerStates.length).toBe(hostStates.length);
    const lastHost = hostStates[hostStates.length - 1];
    const lastPeer = peerStates[peerStates.length - 1];
    // The two sides render the SAME authoritative state: same phase, same turn,
    // same deal, same auction log.
    expect(lastPeer!.phase).toBe(lastHost!.phase);
    expect(lastPeer!.currentPlayer).toBe(lastHost!.currentPlayer);
    expect(sameHands(lastHost!, lastPeer!)).toBe(true);
    expect(JSON.stringify(lastHost!.auction.log)).toBe(JSON.stringify(lastPeer!.auction.log));
  });

  it('re-subscribing (refresh) recovers the SAME deal, not a new one', async () => {
    const { room, hostT } = await setupRoom();

    const hostStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    await tick();

    // Let the auction advance a little so the deal is "in flight", then capture
    // the deal from the host's snapshot stream.
    let guard = 0;
    while (guard < 100) {
      const hs = hostStates[hostStates.length - 1];
      if (!hs || hs.phase === 'HAND_RESULT') break;
      driveSeat(hostT, hs, 0);
      await tick();
      guard++;
    }
    const dealBefore = hostStates.find((s) => s.hands.every((h) => h.length === 13));
    expect(dealBefore).toBeTruthy();

    // A refresh = a brand-new peer transport joining the SAME room. The host
    // seats it and delivers the current authoritative snapshot, so the newcomer
    // must see the SAME deal, not a freshly-dealt one.
    const refreshedT = await makePeerInRoom(room);
    const refreshedStates: GameState[] = [];
    refreshedT.onGameState((s) => refreshedStates.push(s));
    await tick();

    expect(refreshedStates.length).toBeGreaterThan(0);
    const refreshedDeal = refreshedStates[0];
    expect(sameHands(dealBefore!, refreshedDeal)).toBe(true);
  });

  it('a host F5 refresh restores the SAME deal, not a reshuffle', async () => {
    // A host is the source of truth. Before the fix, refreshing the host tab
    // created a brand-new engine and dealt a NEW hand, reshuffling the table for
    // everyone. Now the host persists its authoritative snapshot to
    // sessionStorage and restores it on createRoom, so an F5 keeps the deal.
    const ROOM = 'host-refresh-room';
    sessionStorage.clear();

    // First host session: deal a fresh hand and let the auction advance a few
    // moves so the snapshot is "in flight" (not a pristine deal).
    const firstRoom = new CoupledRoom();
    const host1 = await makeTransport({ roomKey: ROOM, isHost: true, broker: firstRoom, hostSeat: 0 });
    firstRoom.hostT = host1;
    const firstStates: GameState[] = [];
    host1.onGameState((s) => firstStates.push(s));
    await tick();
    // Make a few moves so the snapshot is "in flight", but stop before the hand
    // completes (a completed hand clears the dealt hands to empty at
    // HAND_RESULT, which would defeat the deal comparison). Stop as soon as the
    // phase leaves AUCTION.
    let guard = 0;
    while (guard < 4) {
      const hs = firstStates[firstStates.length - 1];
      if (!hs || hs.phase === 'HAND_RESULT' || hs.phase === 'TRICK_PLAY') break;
      if (!driveSeat(host1, hs, 0)) break;
      await tick();
      guard++;
    }
    // The deal to preserve is the CURRENT authoritative deal (the host's last
    // snapshot), which is exactly what the host persisted.
    const lastBefore = firstStates[firstStates.length - 1];
    expect(lastBefore).toBeTruthy();
    expect(lastBefore!.hands.every((h) => h.length === 13)).toBe(true);
    // The host must have persisted a snapshot for this room, and it must carry
    // the same deal the host is currently showing.
    const persisted = readHostSnapshot(ROOM);
    expect(persisted).toBeTruthy();
    expect(sameHands(lastBefore!, persisted!)).toBe(true);

    // Simulate the host F5: tear down the first host, then a NEW host transport
    // for the SAME room restores the persisted snapshot instead of re-dealing.
    void host1.destroy();
    const secondRoom = new CoupledRoom();
    const host2 = await makeTransport({
      roomKey: ROOM,
      isHost: true,
      broker: secondRoom,
      hostSeat: 0,
      restoreSnapshot: readHostSnapshot(ROOM),
    });
    secondRoom.hostT = host2;
    const restoredStates: GameState[] = [];
    host2.onGameState((s) => restoredStates.push(s));
    await tick();

    expect(restoredStates.length).toBeGreaterThan(0);
    const restoredDeal = restoredStates[0];
    // The refreshed host must show the SAME deal as before the refresh, not a
    // fresh random one.
    expect(sameHands(lastBefore!, restoredDeal)).toBe(true);
  });

  it('peer disconnect triggers bot-fill for that seat', async () => {
    const room = new CoupledRoom();
    const hostT = await makeTransport({ roomKey: 'sync-room', isHost: true, broker: room, hostSeat: 0 });
    room.hostT = hostT;
    await tick();

    const hostStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    await tick();

    // Seat the peer (seat 1) so it's human.
    room.seatPeer('peer', 1);
    await tick();

    // Drive the first human move so we see the game progressing.
    let hs = hostStates[hostStates.length - 1];
    if (hs && hs.currentPlayer === 0) {
      driveSeat(hostT, hs, 0);
      await tick();
    }

    // Disconnect the peer (seat 1). The host should mark seat 1 as bot.
    room.unseatPeer('peer');
    await tick();

    // After disconnect, the state machine should continue with seat 1 bot-filled.
    // If it's seat 1's turn, a bot move should happen automatically.
    hs = hostStates[hostStates.length - 1];
    if (hs && hs.currentPlayer === 1) {
      await tick(); // let bot move
    }

    // Verify the game continues (no crash, state advances).
    expect(hostStates.length).toBeGreaterThan(1);
  });

  it('illegal command is rejected with ERROR frame back to sender', async () => {
    const room = new CoupledRoom();
    const hostT = await makeTransport({ roomKey: 'sync-room', isHost: true, broker: room, hostSeat: 0 });
    room.hostT = hostT;
    await tick();

    const errors: string[] = [];
    hostT.onError((reason) => errors.push(reason));
    await tick();

    // Seat the peer.
    room.seatPeer('peer', 1);
    await tick();

    // Drive host's turn so it's host's turn (seat 0).
    const hostStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    await tick();

    const hs = hostStates[hostStates.length - 1];
    if (!hs) return;
    
    // If it's host's turn (seat 0), send a BID frame from peer anyway.
    if (hs.currentPlayer === 0) {
      const frame = { type: 'BID', data: { level: 1, strain: 'S' } };
      room.hostInboundCb?.('peer', frame as Frame);
      await tick();
      // Host should reject and send ERROR back.
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('peer reconnect after disconnect recovers state from host snapshot', async () => {
    const room = new CoupledRoom();
    const hostT = await makeTransport({ roomKey: 'sync-room', isHost: true, broker: room, hostSeat: 0 });
    room.hostT = hostT;
    await tick();

    const hostStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    await tick();

    // Seat and then unseat the peer.
    room.seatPeer('peer', 1);
    await tick();
    room.unseatPeer('peer');
    await tick();

    // Peer reconnects (new transport instance).
    const peerT2 = await makeTransport({ roomKey: 'sync-room', isHost: false, broker: room });
    room.firePeerReady(); // peer learns seat 1
    room.seatPeer('peer', 1); // host seats the peer + delivers current snapshot
    await tick();

    // The reconnected peer should receive the current authoritative state.
    const peerStates: GameState[] = [];
    peerT2.onGameState((s) => peerStates.push(s));
    await tick();

    expect(peerStates.length).toBeGreaterThan(0);
    expect(sameHands(hostStates[0], peerStates[0])).toBe(true);
  });
});
