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
  type Transport,
  type TransportBroker,
  type Frame,
} from '../src/network/transport';
import { getLegalBids } from '../src/engine/types';
import { getLegalPlays, canPass } from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';
import type { Card, GameState, PlayerIndex } from '../src/engine/types';

const tick = () => new Promise((r) => setImmediate(r));

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
  private hostPeerConnectCb?: (peerId: string) => void;
  private hostInboundCb?: (peerId: string, frame: Frame) => void;
  private peerInboundCb?: (peerId: string, frame: Frame) => void;
  private peerReadyCb?: (info: { peerId: string; seat: PlayerIndex }) => void;
  private isHostRegistering = true;

  async createRoom() {
    return { roomKey: 'sync-room' };
  }
  async connect(_roomKey: string) {}
  onPeerConnect(cb: (peerId: string) => void) {
    this.hostPeerConnectCb = cb;
  }
  seatPeer() {
    this.hostPeerConnectCb?.('peer');
  }
  onPeerDisconnect(_cb: (peerId: string) => void) {}
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

  it('with host + 1 peer, empty seats are bot-driven to HAND_RESULT and both sides agree', async () => {
    const { hostT, peerT } = await setupRoom();

    const hostStates: GameState[] = [];
    const peerStates: GameState[] = [];
    hostT.onGameState((s) => hostStates.push(s));
    peerT.onGameState((s) => peerStates.push(s));
    await tick();

    // Drive the human host seat (0) and the human peer seat (1) each turn; the
    // transport bot-fills the empty seats 2 and 3. The hand must complete with
    // exactly two humans and two bots, and both sides must agree.
    let guard = 0;
    while (guard < 2000) {
      const hs = hostStates[hostStates.length - 1];
      if (!hs || hs.phase === 'HAND_RESULT') break;
      driveSeat(hostT, hs, 0);
      const ps = peerStates[peerStates.length - 1];
      if (ps && ps.currentPlayer === 1 && ps.phase !== 'HAND_RESULT') {
        driveSeat(peerT, ps, 1);
      }
      await tick();
      guard++;
    }
    await tick();
    await tick();

    const lastHost = hostStates[hostStates.length - 1];
    const lastPeer = peerStates[peerStates.length - 1];

    expect(lastHost).toBeTruthy();
    expect(lastPeer).toBeTruthy();
    expect(lastHost!.phase).toBe('HAND_RESULT');
    expect(lastPeer!.phase).toBe('HAND_RESULT');
    expect(lastHost!.tricks.completed.length).toBe(13);
    expect(lastPeer!.tricks.completed.length).toBe(13);

    // Both sides finished with the SAME hands and SAME result.
    expect(sameHands(lastHost!, lastPeer!)).toBe(true);
    expect(JSON.stringify(lastHost!.result)).toBe(JSON.stringify(lastPeer!.result));
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
});
