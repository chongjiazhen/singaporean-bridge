/**
 * Transport layer for host-authoritative P2P multiplayer.
 *
 * transport.ts is the orchestrator seam between the app and the managed
 * broker. It wires signaling (room lifecycle), peer (seat persistence and
 * seat assignment), and protocol (frame serialization) together.
 *
 * Two roles share this module:
 *   - HOST runs the authoritative game engine. It mins a room, seats incoming
 *     peers by arrival order, applies inbound player commands against the live
 *     engine, and broadcasts resulting GAME_STATE snapshots back to peers.
 *   - PEER joins a room, remembers its seated seat, renders incoming GAME_STATE
 *     snapshots, and pushes player commands (BID / CALL_PARTNER / PLAY_CARD)
 *     toward the host.
 *
 * Transport holds NO game logic. It only forwards commands to the engine
 * reducers in host mode and only renders snapshots in peer mode.
 */
import {
  canonicalize,
  isInboundCommandType,
  type Frame,
} from './protocol';
import { rememberSeat } from './peer';
import type { PlayerIndex } from './peer';
import type { GameState, Card, Strain, GameState as EngineState } from '../engine/types';
import {
  makeBid,
  callPartner,
  playCard,
  pass,
  createInitialState,
} from '../engine/gameEngine';

/**
 * A room-scoped, ordered, per-player transport handle.
 *
 * This is the broker contract transport.ts depends on. The concrete managed
 * broker (PeerJS-class) implements it; the tests supply a stub. `createRoom`
 * and `connect` mirror the room-lifecycle of IBroker; the remaining members
 * model the ordered per-player channels the protocol relies on.
 */
export interface TransportBroker {
  // ---- room lifecycle (mirrors IBroker) ----
  createRoom(): Promise<{ roomKey: string }>;
  connect(roomKey: string): Promise<void>;

  // ---- host side ----
  /** A new human peer has joined this room. */
  onPeerConnect(cb: (peerId: string) => void): void;
  /** A human peer has left this room. */
  onPeerDisconnect(cb: (peerId: string) => void): void;
  /** A frame arrived from `peerId`, in arrival order on that peer's channel. */
  onInboundFrame(cb: (peerId: string, frame: Frame) => void): void;
  /** Deliver a frame to one specific peer (host -> peer). */
  deliverToPeer(peerId: string, frame: Frame): Promise<void>;

  // ---- peer side ----
  /** This instance has been seated by the broker. */
  onPeerReady(cb: (info: { peerId: string; seat: PlayerIndex }) => void): void;
  /** Send a frame toward the host (peer -> host). */
  sendToPeer(frame: Frame): Promise<void>;

  /** Tear down the room handle and its channels. */
  disconnect(): void;
}

/** Options accepted by {@link makeTransport}. */
export interface MakeTransportOptions {
  /** The room key, parsed from `#join/<roomKey>`. */
  roomKey: string;
  /** Whether this instance is the host (authoritative engine) or a peer. */
  isHost: boolean;
  /** A broker to use; defaults to {@link InMemoryBroker}. */
  broker?: TransportBroker;
  /** The host's own seat (0..3). Only meaningful when `isHost`. */
  hostSeat?: PlayerIndex;
}

/** The public transport handle the app consumes. */
export interface Transport {
  /** The seat this instance occupies. Undefined until seated. */
  readonly seat: PlayerIndex | undefined;
  /** Whether this instance runs the authoritative engine. */
  readonly isHost: boolean;
  /** Receive canonicalized GAME_STATE snapshots (peer mode). */
  onGameState(cb: (state: GameState) => void): void;
  /** Receive a newly-seeded human peer (host mode). */
  onPeerAssigned(cb: (info: { seat: PlayerIndex; peerId: string }) => void): void;
  /** Receive a non-fatal error reason (host mode rejects). */
  onError(cb: (reason: string) => void): void;
  /** Bid from the current seat (peer: forward to host; host: apply locally). */
  sendBid(level: number, strain: Strain): void;
  /** Ask the current seat's partner to play a card (peer: forward to host; host: apply locally). */
  sendCallPartner(card: Card): void;
  /** Play a card from the current seat (peer: forward to host; host: apply locally). */
  sendPlayCard(card: Card): void;
  /** Host-driven only: apply a pass for a seat and broadcast the resulting snapshot. */
  sendPass(seat?: PlayerIndex): void;
  /** Receive any non-GAME_STATE frame forwarded from the broker (both modes). */
  onCommand(cb: (frame: Frame) => void): void;
  /** Tear down the transport and its broker handle. */
  destroy(): void;
}

/**
 * Default in-memory broker used when no broker is supplied.
 *
 * This is a placeholder for the real managed broker. It is in-process and
 * room-keyed so multiple rooms stay isolated, but it does not model real
 * networking. It exists so transport.ts is testable and runnable without a
 * broker SDK.
 */
export class InMemoryBroker implements TransportBroker {
  private roomKey?: string;
  private seat?: PlayerIndex;

  private peerConnectCbs = new Set<(peerId: string) => void>();
  private peerDisconnectCbs = new Set<(peerId: string) => void>();
  private inboundCbs = new Set<(peerId: string, frame: Frame) => void>();
  private readyCbs = new Set<(info: { peerId: string; seat: PlayerIndex }) => void>();

  private sent: Frame[] = [];
  private inbox: { peerId: string; frame: Frame }[] = [];

  async createRoom(): Promise<{ roomKey: string }> {
    const key = `${this.roomKey ?? 'room-'}${Math.random().toString(36).slice(2, 10)}`;
    this.roomKey = key;
    return { roomKey: key };
  }

  async connect(roomKey: string): Promise<void> {
    this.roomKey = roomKey;
  }

  onPeerConnect(cb: (peerId: string) => void): void {
    this.peerConnectCbs.add(cb);
  }
  onPeerDisconnect(cb: (peerId: string) => void): void {
    this.peerDisconnectCbs.add(cb);
  }
  onInboundFrame(cb: (peerId: string, frame: Frame) => void): void {
    this.inboundCbs.add(cb);
  }
  async deliverToPeer(peerId: string, frame: Frame): Promise<void> {
    this.inbox.push({ peerId, frame });
  }

  onPeerReady(cb: (info: { peerId: string; seat: PlayerIndex }) => void): void {
    this.readyCbs.add(cb);
  }
  async sendToPeer(frame: Frame): Promise<void> {
    this.sent.push(frame);
  }

  /** Test helper: fire a peer-join on the broker. */
  __emitPeerConnect(peerId: string): void {
    this.peerConnectCbs.forEach((cb) => cb(peerId));
  }
  /** Test helper: feed an inbound frame from a peer. */
  __emitInbound(peerId: string, frame: Frame): void {
    this.inboundCbs.forEach((cb) => cb(peerId, frame));
  }
  /** Test helper: seat this instance on the broker. */
  __emitPeerReady(seat: PlayerIndex): void {
    this.seat = seat;
    this.readyCbs.forEach((cb) => cb({ peerId: this.roomKey ?? '', seat }));
  }
  /** Test helper: read frames this broker captured as sent. */
  __sent(): Frame[] {
    return this.sent;
  }
  /** Test helper: read frames queued to a peer. */
  __inboxFor(peerId: string): Frame[] {
    return this.inbox.filter((e) => e.peerId === peerId).map((e) => e.frame);
  }
  /** Test helper: reset captured state between scenarios. */
  __reset(): void {
    this.sent.length = 0;
    this.inbox.length = 0;
    this.readyCbs.clear();
    this.peerConnectCbs.clear();
    this.peerDisconnectCbs.clear();
    this.inboundCbs.clear();
  }

  disconnect(): void {
    this.peerConnectCbs.clear();
    this.peerDisconnectCbs.clear();
    this.inboundCbs.clear();
    this.readyCbs.clear();
    this.sent.length = 0;
    this.inbox.length = 0;
    this.roomKey = undefined;
  }
}

/** Apply an inbound player command against the authoritative engine. */
function applyInboundCommand(state: EngineState, seat: PlayerIndex, frame: Frame): EngineState {
  const data = (frame.data ?? {}) as Record<string, unknown>;
  switch (frame.type) {
    case 'BID': {
      const level = typeof data.level === 'number' ? data.level : 1;
      const strain = data.strain as Strain;
      return makeBid(state, seat, level, strain);
    }
    case 'CALL_PARTNER':
      return callPartner(state, seat, data.card as Card);
    case 'PLAY_CARD':
      return playCard(state, seat, data.card as Card);
    default:
      throw new Error(`unsupported command frame: ${String(frame.type)}`);
  }
}

/**
 * Seat incoming connections by arrival order.
 *
 * seat = (hostSeat + arrivalPosition) % 4, where arrivalPosition is the 1-based
 * position at which the connection joined. Ties (same position) are broken
 * deterministically by lexicographically smaller connectionId.
 */
function assignSeats(
  hostSeat: PlayerIndex,
  arrivalOrder: Map<string, number>
): Map<string, PlayerIndex> {
  const result = new Map<string, PlayerIndex>();
  if (arrivalOrder.size === 0) return result;
  const sorted = [...arrivalOrder].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });
  sorted.forEach(([connId, _pos], index) => {
    const arrivalPosition = index + 1;
    result.set(connId, ((hostSeat + arrivalPosition) % 4) as PlayerIndex);
  });
  return result;
}

/**
 * Build a transport handle for the current instance.
 *
 * In host mode it runs the authoritative engine, seats incoming peers by
 * arrival order, and broadcasts GAME_STATE snapshots. In peer mode it renders
 * incoming snapshots and pushes player commands to the host.
 */
export function makeTransport(opts: MakeTransportOptions): Promise<Transport> {
  const broker = opts.broker ?? new InMemoryBroker();

  const handlers: {
    onGameStateCb: ((state: GameState) => void) | undefined;
    onPeerAssignedCb: ((info: { seat: PlayerIndex; peerId: string }) => void) | undefined;
    onErrorCb: ((reason: string) => void) | undefined;
    onCommandCb: ((frame: Frame) => void) | undefined;
  } = {};

  let currentSeat: PlayerIndex | undefined;

  // Authoritative engine state (host mode). Every applied command broadcasts a
  // fresh snapshot so host and every peer render the same source of truth.
  let state: EngineState = createInitialState();
  const peers = new Set<string>();

  const broadcastState = (newState: EngineState) => {
    const snapshot: Frame = { type: 'GAME_STATE', data: canonicalize(newState) };
    for (const peerId of peers) {
      void broker.deliverToPeer(peerId, snapshot);
    }
    handlers.onGameStateCb?.(canonicalize<GameState>(newState));
  };

  const applyCommand = (peerId: string, frame: Frame) => {
    const seat = assignSeats(opts.hostSeat ?? 0, arrivalOrder).get(peerId);
    if (seat === undefined) {
      handlers.onCommandCb?.(frame);
      return;
    }
    if (!isInboundCommandType(frame.type)) {
      handlers.onCommandCb?.(frame);
      return;
    }
    try {
      state = applyInboundCommand(state, seat, frame);
      broadcastState(state);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      handlers.onErrorCb?.(reason);
      const rejected: Frame = { type: 'ERROR', data: { reason, commandId: peerId } };
      void broker.deliverToPeer(peerId, rejected);
    }
  };

  const transport: Transport = {
    get seat() {
      return currentSeat;
    },
    get isHost() {
      return opts.isHost;
    },
    onGameState(cb) {
      handlers.onGameStateCb = cb;
    },
    onPeerAssigned(cb) {
      handlers.onPeerAssignedCb = cb;
    },
    onError(cb) {
      handlers.onErrorCb = cb;
    },
    sendBid(level, strain) {
      if (opts.isHost) {
        applyCommand('host', { type: 'BID', data: { level, strain } } as Frame);
        return;
      }
      void broker.sendToPeer({ type: 'BID', data: { level, strain } });
    },
    sendCallPartner(card) {
      if (opts.isHost) {
        applyCommand('host', { type: 'CALL_PARTNER', data: { card } } as Frame);
        return;
      }
      void broker.sendToPeer({ type: 'CALL_PARTNER', data: { card } });
    },
    sendPlayCard(card) {
      if (opts.isHost) {
        applyCommand('host', { type: 'PLAY_CARD', data: { card } } as Frame);
        return;
      }
      void broker.sendToPeer({ type: 'PLAY_CARD', data: { card } });
    },
    onCommand(cb) {
      handlers.onCommandCb = cb;
    },
    // The host drives passing for any seat; peers never send a pass frame
    // (per spec, pass is host-authoritative with no wire frame).
    sendPass(reqSeat?: PlayerIndex) {
      if (!opts.isHost) return;
      const seat: PlayerIndex = reqSeat ?? (opts.hostSeat ?? 0);
      try {
        state = pass(state, seat);
        broadcastState(state);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        handlers.onErrorCb?.(reason);
      }
    },
    destroy() {
      broker.disconnect();
    },
  };

  const arrivalOrder = new Map<string, number>();

  void broker.connect(opts.roomKey).then(() => {
    if (opts.isHost) {
      void broker.createRoom();
      // Host seats incoming peers by arrival order.
      broker.onPeerConnect((peerId) => {
        if (!arrivalOrder.has(peerId)) {
          arrivalOrder.set(peerId, arrivalOrder.size + 1);
          peers.add(peerId);
        }
        const seat = assignSeats(opts.hostSeat ?? 0, arrivalOrder).get(peerId);
        if (seat !== undefined) {
          currentSeat = seat;
          handlers.onPeerAssignedCb?.({ seat, peerId });
        }
      });
      broker.onInboundFrame((peerId, frame) => {
        applyCommand(peerId, frame);
      });
    } else {
      // Peer mode: remember seat, render snapshots, forward commands.
      broker.onPeerReady(({ seat }) => {
        currentSeat = seat;
        rememberSeat(opts.roomKey, seat);
      });
      broker.onInboundFrame((_peerId, frame) => {
        if (frame.type === 'GAME_STATE') {
          handlers.onGameStateCb?.(canonicalize<GameState>(frame.data));
          return;
        }
        handlers.onCommandCb?.(frame);
      });
    }
  });

  return Promise.resolve(transport);
}
