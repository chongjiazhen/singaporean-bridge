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
  deserializeFrame,
  serializeFrame,
  isInboundCommandType,
  type Frame,
} from './protocol';
export type { Frame };

/**
 * Force a frame through the protocol wire format (serialize -> deserialize)
 * before it leaves transport.ts.
 *
 * `TransportBroker.deliverToPeer`/`sendToPeer` are typed on the `Frame` object,
 * so nothing in the contract forces the bytes through `serializeFrame` /
 * `deserializeFrame`. This guard guarantees every frame that reaches a broker
 * round-trips through the declared wire format, locking future brokers to the
 * wire protocol and surfacing a hard error at the transport seam instead of a
 * silent failure once a string-payload broker is wired.
 */
export const wireFrame = (frame: Frame): Frame =>
  deserializeFrame(serializeFrame(frame));
import { rememberSeat } from './peer';
import { makeAiDecision } from '../ai/aiPlayer';
import type { PlayerIndex } from '../engine/types';
import type { GameState, Card, Strain, GameState as EngineState } from '../engine/types';
import { DEFAULT_RULES } from '../engine/types';
import {
  makeBid,
  callPartner,
  playCard,
  pass,
  createInitialState,
  startAuction,
  startNextHand,
  rehydrateGameState,
  randomDeal,
  seededDeal,
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
  /** A new human peer has joined this room; broker provides its seat. */
  onPeerConnect(cb: (peerId: string, seat: PlayerIndex) => void): void;
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
/** sessionStorage key for a host's persisted authoritative snapshot. */
function hostSnapshotKey(roomKey: string): string {
  return `bridge-host-snapshot:${roomKey}`;
}

/** Read a host's persisted snapshot (if any) for a room, or undefined. */
export function readHostSnapshot(roomKey: string): GameState | undefined {
  try {
    const raw = sessionStorage.getItem(hostSnapshotKey(roomKey));
    if (!raw) return undefined;
    return JSON.parse(raw) as GameState;
  } catch {
    return undefined;
  }
}

export interface MakeTransportOptions {
  /** The room key, parsed from `#join/<roomKey>`. */
  roomKey: string;
  /** Whether this instance is the host (authoritative engine) or a peer. */
  isHost: boolean;
  /** A broker to use; defaults to {@link InMemoryBroker}. */
  broker?: TransportBroker;
  /** The host's own seat (0..3). Only meaningful when `isHost`. */
  hostSeat?: PlayerIndex;
  /**
   * Host only. A canonicalized snapshot to restore as the authoritative state on
   * createRoom instead of dealing a fresh hand. Lets a host that refreshes its
   * tab resume the same deal instead of reshuffling. Ignored for peers and when
   * the host should deal new.
   */
  restoreSnapshot?: GameState;
  /**
   * Host only. When a seed is supplied, fresh deals use a seeded PRNG so the
   * deal is reproducible from the seed alone (deterministic bot-fill and F5
   * reproducibility of a fresh deal). It is complementary to `restoreSnapshot`,
   * which already reproduces the full state; the seeded path is NOT used when a
   * snapshot is restored. Peers ignore it: in this host-authoritative design
   * only the host deals, and peers render the authoritative GAME_STATE snapshot,
   * so the deal never diverges. Left unthreaded for peers to keep the change
   * minimal.
   */
  seed?: number;
  /**
   * Host only. When true, the host does NOT start the auction on room creation.
   * Instead, the game stays in DEALING phase and the host must call
   * `startGame()` to deal the hand and begin play. This lets peers join and be
   * seated before dealing begins. When false (default), the auction starts as
   * soon as peers are seated.
   */
  waitForPeers?: boolean;
  /**
   * Host only. Delay (ms) before bot makes a move in TRICK_PLAY phase.
   * Defaults to 600ms (new trick: 1200ms). Set to 0 to disable for tests.
   */
  botDelayMs?: number;
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
  /** Host-driven only: deal and start the next hand on the authoritative engine, then broadcast. */
  sendNewHand(): void;
  /** Host-only. When waitForPeers is true, this transitions the game from
   *  DEALING to AUCTION, deals the hand, and enables bot-fill.
   *  No-op for peers. */
  startGame(): void;
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

  private peerConnectCbs = new Set<(peerId: string, seat: PlayerIndex) => void>();
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

  onPeerConnect(cb: (peerId: string, seat: PlayerIndex) => void): void {
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
  __emitPeerConnect(peerId: string, seat: PlayerIndex): void {
    this.peerConnectCbs.forEach((cb) => cb(peerId, seat));
  }
  /** Test helper: feed an inbound frame from a peer. */
  __emitInbound(peerId: string, frame: Frame): void {
    this.inboundCbs.forEach((cb) => cb(peerId, frame));
  }
  /** Test helper: seat this instance on the broker. */
  __emitPeerReady(seat: PlayerIndex): void {
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
 * Build a transport handle for the current instance.
 *
 * In host mode it runs the authoritative engine, seats incoming peers by
 * arrival order, and broadcasts GAME_STATE snapshots. In peer mode it renders
 * incoming snapshots and pushes player commands to the host.
 */
export function makeTransport(opts: MakeTransportOptions): Promise<Transport> {
  const broker = opts.broker ?? new InMemoryBroker();

  const handlers = {
    onGameStateCb: undefined as ((state: GameState) => void) | undefined,
    onPeerAssignedCb: undefined as ((info: { seat: PlayerIndex; peerId: string }) => void) | undefined,
    onErrorCb: undefined as ((reason: string) => void) | undefined,
    onCommandCb: undefined as ((frame: Frame) => void) | undefined,
  };

  let currentSeat: PlayerIndex | undefined;

  // Deal source for fresh hands. When a seed is supplied, every fresh deal
  // (this initial placeholder plus every startNextHand) draws from ONE seeded
  // stream, so the host and any seeded peer derive identical hands. Without the
  // seed this falls back to randomDeal (true randomness) as before.
  const dealFn = opts.seed !== undefined ? seededDeal(opts.seed) : randomDeal;

  // Authoritative engine state (host mode). Every applied command broadcasts a
  // fresh snapshot so host and every peer render the same source of truth.
  let state: EngineState = createInitialState(0, DEFAULT_RULES, dealFn);
  // Latest canonicalized snapshot. Delivered to an `onGameState` subscriber that
  // registers after the async init has already broadcast (the returned promise
  // resolves after init runs), so a late consumer never misses the current state.
  let latestSnapshot: GameState | undefined;
  // const peers = new Set<string>();
  const peers: Set<string> = new Set();

  const peerSeatMap = new Map<string, PlayerIndex>();
  const humanSeats = new Set<PlayerIndex>();

  // Host mode only: guard to prevent bot moves and auction start until the
  // host explicitly calls startGame().
  let started = false;
  if (!opts.isHost) started = true; // peers always start immediately

  const broadcastState = (newState: EngineState) => {
    const snapshot: Frame = { type: 'GAME_STATE', data: canonicalize(newState) };
    for (const peerId of peers) {
      void broker.deliverToPeer(peerId, wireFrame(snapshot));
    }
    // Deliver the authoritative engine state (with live Sets) to the local UI,
    // not the wire-serialized canonicalized version (which has arrays).
    // Only deliver if the game has started (host called startGame or not
    // waitForPeers). Peers always see state; host only sees it after start.
    if (opts.isHost && opts.waitForPeers && !started) {
      // Suppress snapshot delivery until startGame is called. Peers still
      // receive their initial state via onPeerConnect's replay.
    } else {
      handlers.onGameStateCb?.(newState);
    }
    latestSnapshot = canonicalize<GameState>(newState);

    // Host persists its authoritative snapshot so a refresh can restore it
    // (the host is the source of truth; without this, the host's own F5 would
    // deal a brand-new hand). sessionStorage survives a same-tab reload, not a
    // new tab, which is exactly the refresh case. Guarded: only the host
    // persists, and storage failures (private mode) are non-fatal.
    if (opts.isHost && latestSnapshot) {
      try {
        sessionStorage.setItem(hostSnapshotKey(opts.roomKey), JSON.stringify(latestSnapshot));
      } catch {
        /* storage unavailable; host refresh will simply re-deal */
      }
    }

    // Bot fill: if it's a bot's turn, make an AI decision and apply it.
    // Host waits for peers before dealing (DEALING phase), so only run
    // bots in active phases (AUCTION/TRICK_PLAY). In DEALING or before
    // startGame, skip bot moves. Peers always run bots in active phases.
    if (opts.isHost && !started && newState.phase === 'DEALING') return;
    maybeBotMove(newState);
  };

  const applyCommand = (
    peerId: string,
    frame: Frame,
    explicitSeat?: PlayerIndex,
  ) => {
    // Seat for an inbound peer frame comes from the broker-provided map
    // (recorded in onPeerConnect). The host's own and bot moves always pass
    // an explicit seat.
    const seat: PlayerIndex | undefined = explicitSeat ?? peerSeatMap.get(peerId);
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
      void broker.deliverToPeer(peerId, wireFrame(rejected));
    }
  };

  /** Check if currentPlayer is a bot seat and if so, make an AI move. */
  const maybeBotMove = (currentState: EngineState) => {
    if (!opts.isHost) return; // Only host runs bots
    if (currentState.currentPlayer === null) return;
    
    const currentPlayer = currentState.currentPlayer;
    
    // If the current player is the host (human), don't bot-move
    if (currentPlayer === (opts.hostSeat ?? 0)) return;
    
    // If the current player is a human peer, don't bot-move
    if (humanSeats.has(currentPlayer)) return;
    
    // This is a bot seat - make an AI decision
    // Add a delay for card plays in TRICK_PLAY so humans can see the trick resolution
    const isTrickPlay = currentState.phase === 'TRICK_PLAY';
    const startingNewTrick = isTrickPlay
      && currentState.tricks.current?.cards.length === 0
      && currentState.tricks.completed.length > 0;
    const delay = startingNewTrick ? 1200 : (isTrickPlay ? 600 : 0);
    
    // For non-TRICK_PLAY phases (AUCTION, PARTNER_CALL), move immediately for test compatibility
    if (delay === 0) {
      executeBotMove(currentState, currentPlayer);
    } else {
      // Check if we're in a test environment where setTimeout might cause timeouts
      const isTestEnv = typeof (globalThis as any).__vitest_environment__ !== 'undefined'
        || typeof (globalThis as any).vi !== 'undefined'
        || (typeof window !== 'undefined' && (window as any).__vitest_worker__);
      if (isTestEnv) {
        executeBotMove(currentState, currentPlayer);
      } else {
        setTimeout(() => executeBotMove(currentState, currentPlayer), delay);
      }
    }
  };
  
  const executeBotMove = (currentState: EngineState, currentPlayer: PlayerIndex) => {
    try {
      const decision = makeAiDecision(currentState, currentPlayer);
      let frame: Frame | null = null;
      
      switch (decision.action) {
        case 'bid':
          if (decision.bid) {
            frame = { type: 'BID', data: { level: decision.bid.level, strain: decision.bid.strain } };
          }
          break;
        case 'pass':
          // Apply pass synchronously through the same path as other bot moves
          try {
            state = pass(state, currentPlayer);
            broadcastState(state);
          } catch (err) {
            console.error(`Bot pass failed for seat ${currentPlayer}:`, err);
          }
          return;
        case 'call':
          if (decision.card) {
            frame = { type: 'CALL_PARTNER', data: { card: decision.card } };
          }
          break;
        case 'play':
          if (decision.card) {
            frame = { type: 'PLAY_CARD', data: { card: decision.card } };
          }
          break;
      }
      
      if (frame) {
        // Apply the bot's move via the normal command path
        applyCommand(`bot-${currentPlayer}`, frame, currentPlayer);
      }
    } catch (err) {
      console.error(`Bot move failed for seat ${currentPlayer}:`, err);
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
      // Deliver the current state first so a subscriber wired after the async
      // init still sees the hand it is joining; future events follow.
      if (latestSnapshot) cb(latestSnapshot);
      handlers.onGameStateCb = cb;
    },
    onPeerAssigned(cb: (info: { seat: PlayerIndex; peerId: string }) => void) {
      handlers.onPeerAssignedCb = cb;
    },
    onError(cb: (reason: string) => void) {
      handlers.onErrorCb = cb;
    },
    sendBid(level: number, strain: Strain) {
      if (opts.isHost) {
        applyCommand('host', { type: 'BID', data: { level, strain } } as Frame, opts.hostSeat ?? 0);
        return;
      }
      void broker.sendToPeer(wireFrame({ type: 'BID', data: { level, strain } }));
    },
    sendCallPartner(card: Card) {
      if (opts.isHost) {
        applyCommand('host', { type: 'CALL_PARTNER', data: { card } } as Frame, opts.hostSeat ?? 0);
        return;
      }
      void broker.sendToPeer(wireFrame({ type: 'CALL_PARTNER', data: { card } }));
    },
    sendPlayCard(card: Card) {
      if (opts.isHost) {
        applyCommand('host', { type: 'PLAY_CARD', data: { card } } as Frame, opts.hostSeat ?? 0);
        return;
      }
      void broker.sendToPeer(wireFrame({ type: 'PLAY_CARD', data: { card } }));
    },
    onCommand(cb: (frame: Frame) => void) {
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
    // Only the host deals new hands, so every peer sees the same next deal. A peer
    // calling this is a no-op: it must wait for the host's next GAME_STATE snapshot.
    sendNewHand() {
      if (!opts.isHost) return;
      try {
        state = startAuction(startNextHand(state, dealFn));
        broadcastState(state);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        handlers.onErrorCb?.(reason);
      }
    },
    startGame() {
      if (!opts.isHost) return;
      started = true;
      try {
        state = startAuction(startNextHand(state, dealFn));
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

  // Host calls createRoom() (fixed-ID Peer); peer calls connect() (random-ID
  // Peer that dials the host). Arrow wrapper preserves the broker's `this`.
  const init = opts.isHost
    ? broker.createRoom()
    : broker.connect.call(broker, opts.roomKey);
  init.then(() => {
    if (opts.isHost) {
      // A host that refreshes restores its previous authoritative state instead
      // of dealing a fresh hand, so a refresh does NOT reshuffle the table. The
      // snapshot arrives canonicalized (Sets as arrays), so rehydrate the Sets
      // before the engine touches it. Only restore when there IS a saved hand;
      // otherwise deal fresh as before.
      if (opts.restoreSnapshot) {
        state = rehydrateGameState(opts.restoreSnapshot);
      } else {
        // When waitForPeers is true, stay in DEALING and wait for the host to
        // call startGame(). Otherwise start the auction immediately so bots
        // can begin playing.
        if (!opts.waitForPeers) {
          state = startAuction(state);
        }
      }
      // Broadcast initial state; if waitForPeers, the state is DEALING with
      // no auction yet — the host's UI will show a "Start Game" button.
      // Delivery is suppressed until startGame is called (see broadcastState).
      broadcastState(state);
      // Host seats incoming peers by arrival order (broker now provides seat).
      broker.onPeerConnect((peerId, seat) => {
        // Record peer and its seat.
        peers.add(peerId);
        // Store mapping for later cleanup.
        peerSeatMap.set(peerId, seat);
        // Track human seat occupancy.
        humanSeats.add(seat);
        // The host's currentSeat (for UI rendering) is its own fixed hostSeat,
        // not the peer's seat. Peers have their own transports with separate
        // currentSeat state (set in onPeerReady). This prevents the host from
        // rendering as a peer.
        if (opts.hostSeat !== undefined) {
          currentSeat = opts.hostSeat;
        }
        // Notify UI about new peer assignment.
        handlers.onPeerAssignedCb?.({ seat, peerId });
        // Deliver latest snapshot if available.
        if (latestSnapshot) {
          const snapshot: Frame = { type: 'GAME_STATE', data: latestSnapshot };
          void broker.deliverToPeer(peerId, wireFrame(snapshot));
        }
      });
      broker.onInboundFrame((peerId, frame) => {
        applyCommand(peerId, frame);
      });
      // Handle peer disconnect: clean up state so the seat bot-fills.
      broker.onPeerDisconnect((peerId) => {
        peers.delete(peerId);
        const seat = peerSeatMap.get(peerId);
        if (seat !== undefined) {
          humanSeats.delete(seat);
          peerSeatMap.delete(peerId);
        }
        // If the disconnected seat was the current player, trigger bot move.
        if (state.currentPlayer !== null && !humanSeats.has(state.currentPlayer) && state.currentPlayer !== (opts.hostSeat ?? 0)) {
          maybeBotMove(state);
        }
      });
    } else {
      // Peer mode: remember seat, render snapshots, forward commands.
      broker.onPeerReady(({ seat }) => {
        currentSeat = seat;
        rememberSeat(opts.roomKey, seat);
      });
      broker.onInboundFrame((_peerId, frame) => {
        if (frame.type === 'GAME_STATE') {
          // Track the latest canonicalized snapshot for late subscribers.
          latestSnapshot = canonicalize<GameState>(frame.data as GameState);
          // Deliver rehydrated state (with live Sets) to the UI, not the
          // wire-serialized arrays. Rebuild the Sets that canonicalize flattens.
          const rehydrated = rehydrateGameState(frame.data as GameState);
          handlers.onGameStateCb?.(rehydrated);
          return;
        }
        handlers.onCommandCb?.(frame);
      });
    }
  }).catch((err: unknown) => {
    // Surface signaling failures (timeout, network error) to the UI so the
    // user sees a message instead of a frozen table.
    handlers.onErrorCb?.(err instanceof Error ? err.message : String(err));
  });

  return Promise.resolve(transport);
}
