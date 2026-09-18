/**
 * PeerJS implementation of the TransportBroker contract.
 *
 * Uses the managed PeerServer Cloud (0.peerjs.com:443) for signaling and
 * NAT traversal. Data plane stays direct WebRTC (DTLS); broker only handles
 * signaling + relay fallback.
 */
import { Peer } from 'peerjs';
import type { TransportBroker, Frame } from './transport';
import type { PlayerIndex } from '../engine/types';
import { ReclaimMap } from './peer';

const PEER_OPEN_TIMEOUT_MS = 10_000;

/**
 * Reject with a descriptive error if `promise` does not settle within
 * `ms` milliseconds. Prevents the UI from freezing forever when the
 * PeerJS signaling handshake stalls (e.g. no outbound internet, cloud
 * server unreachable).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

interface PeerJsBrokerConfig {
  /** Host's fixed peer ID = roomKey. */
  roomKey: string;
  /** Whether this instance is the host. */
  isHost: boolean;
  /** Host's seat index (0-3). Only used when isHost=true. */
  hostSeat?: PlayerIndex;
}

export class PeerJsBroker implements TransportBroker {
  private peer: Peer | null = null;
  private roomKey: string;
  private isHost: boolean;
  private hostSeat: PlayerIndex;
  private connections = new Map<string, any>();

  // Callbacks
  private onPeerConnectCb: ((peerId: string) => void) | null = null;
  private onPeerDisconnectCb: ((peerId: string) => void) | null = null;
  private onInboundFrameCb: ((peerId: string, frame: Frame) => void) | null = null;
  private onPeerReadyCb: ((info: { peerId: string; seat: PlayerIndex }) => void) | null = null;
  private arrivalOrder = new Map<string, number>();
  private seatMap = new Map<string, PlayerIndex>();
  private nextArrivalPosition = 1;
  private reclaimMap = new ReclaimMap();

  constructor(config: PeerJsBrokerConfig) {
    this.roomKey = config.roomKey;
    this.isHost = config.isHost;
    this.hostSeat = config.hostSeat ?? 0;
  }

  async createRoom(): Promise<{ roomKey: string }> {
    if (!this.isHost) {
      throw new Error('createRoom only valid in host mode');
    }
    // Host creates exactly one Peer instance with roomKey as fixed peer ID.
    // Idempotent: reuse a live Peer (StrictMode double-mount guard).
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
      this.peer = new Peer(this.roomKey, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 0,
      });
    }

    if (!this.peer.open) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.peer!.on('open', () => resolve());
          this.peer!.on('error', (err) => reject(err));
        }),
        PEER_OPEN_TIMEOUT_MS,
        'PeerJS signaling connection timed out',
      );
    }

    // Listen for incoming peer connections (attach once; PeerJS dedupes).
    this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));

    return { roomKey: this.roomKey };
  }

  async connect(roomKey: string): Promise<void> {
    this.roomKey = roomKey;
    // Peer mode: create Peer for signaling, then connect to host.
    // Idempotent: if a Peer already exists and is alive, reuse it (StrictMode
    // double-invokes effects; the first call's Peer may already be open or
    // connecting). If it was destroyed, create a fresh one.
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) {
      this.peer = new Peer({
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 0,
      });
    }

    if (!this.peer.open) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.peer!.on('open', () => resolve());
          this.peer!.on('error', (err) => reject(err));
        }),
        PEER_OPEN_TIMEOUT_MS,
        'PeerJS signaling connection timed out',
      );
    }

    if (!this.isHost) {
      // Peer connects to host's fixed ID (the roomKey).
      // Guard: if the connection to host is already established, skip.
      const existing = this.connections.get('host');
      if (existing && existing.open) return;
      const conn = this.peer.connect(this.roomKey, {
        reliable: true,
      });
      this.setupConnection(conn, 'host');
    }
  }

  private handleIncomingConnection(conn: any): void {
    this.setupConnection(conn, conn.peer);
  }

  private setupConnection(conn: any, peerId: string): void {
    conn.on('open', () => {
      if (this.isHost) {
        const now = Date.now();
        // Check if this peer can reclaim a seat from a previous connection
        const reclaimedSeat = this.reclaimMap.reconnSeat(peerId, now);
        
        let seat: PlayerIndex;
        if (reclaimedSeat !== null) {
          // Peer is reconnecting within the window - reuse their seat
          seat = reclaimedSeat;
          // Update the reclaim map with the new connection timestamp
          this.reclaimMap.set(peerId, seat, now);
        } else {
          // New peer - assign seat by arrival order
          if (!this.arrivalOrder.has(peerId)) {
            this.arrivalOrder.set(peerId, this.nextArrivalPosition++);
          }
          seat = this.assignSeat(peerId);
          // Record this connection for potential future reclaim
          this.reclaimMap.set(peerId, seat, now);
        }
        
        this.seatMap.set(peerId, seat);

        // Send seat assignment to ALL peers so they can update their UI/seatMap
        const assignmentFrame: Frame = {
          type: 'PLAYER_ASSIGNMENT',
          data: { seat, peerId },
        };

        // Broadcast to existing peers
        for (const [, existingConn] of this.connections) {
          if (existingConn.open) {
            existingConn.send(assignmentFrame);
          }
        }

        // Also send to the newly connecting peer (if not already covered, but safe to ensure)
        if (conn.open) {
          conn.send(assignmentFrame);
        }

        this.onPeerConnectCb?.(peerId);
        this.onPeerReadyCb?.({ peerId, seat });
      } else {
        // Peer mode: wait for PLAYER_ASSIGNMENT from host
      }
    });

    conn.on('data', (data: any) => {
      const frame = data as Frame;
      if (frame.type === 'PLAYER_ASSIGNMENT' && !this.isHost) {
        const assignment = frame.data as { peerId: string; seat: PlayerIndex };
        this.onPeerReadyCb?.({ peerId: assignment.peerId, seat: assignment.seat });
      } else {
        this.onInboundFrameCb?.(peerId, frame);
      }
    });

    conn.on('close', () => {
      this.connections.delete(peerId);
      if (this.isHost) {
        this.onPeerDisconnectCb?.(peerId);
      }
    });

    conn.on('error', (err: Error) => {
      console.error(`Connection error with ${peerId}:`, err);
    });

    this.connections.set(peerId, conn);
  }

  private assignSeat(peerId: string): PlayerIndex {
    const arrivalPosition = this.arrivalOrder.get(peerId) ?? 1;
    return ((this.hostSeat + arrivalPosition) % 4) as PlayerIndex;
  }

  onPeerConnect(cb: (peerId: string) => void): void {
    this.onPeerConnectCb = cb;
  }

  onPeerDisconnect(cb: (peerId: string) => void): void {
    this.onPeerDisconnectCb = cb;
  }

  onInboundFrame(cb: (peerId: string, frame: Frame) => void): void {
    this.onInboundFrameCb = cb;
  }

  async deliverToPeer(peerId: string, frame: Frame): Promise<void> {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(frame);
    } else {
      throw new Error(`No open connection to peer ${peerId}`);
    }
  }

  onPeerReady(cb: (info: { peerId: string; seat: PlayerIndex }) => void): void {
    this.onPeerReadyCb = cb;
  }

  async sendToPeer(frame: Frame): Promise<void> {
    // In peer mode, send to host (connection keyed as 'host')
    const conn = this.connections.get('host');
    if (conn && conn.open) {
      conn.send(frame);
    } else {
      throw new Error('No open connection to host');
    }
  }

  disconnect(): void {
    for (const [, conn] of this.connections) {
      conn.close();
    }
    this.connections.clear();
    this.arrivalOrder.clear();
    this.seatMap.clear();
    this.nextArrivalPosition = 1;
    this.reclaimMap.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  /** Get the seat assigned to a peer (host mode only). */
  getSeat(peerId: string): PlayerIndex | undefined {
    return this.seatMap.get(peerId);
  }
}