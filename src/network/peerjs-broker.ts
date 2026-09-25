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
  private onPeerConnectCb: ((peerId: string, seat: PlayerIndex) => void) | null = null;
  private onPeerDisconnectCb: ((peerId: string) => void) | null = null;
  private onInboundFrameCb: ((peerId: string, frame: Frame) => void) | null = null;
  private onPeerReadyCb: ((info: { peerId: string; seat: PlayerIndex }) => void) | null = null;
  private arrivalOrder = new Map<string, number>();
  private seatMap = new Map<string, PlayerIndex>();
  private nextArrivalPosition = 1;
  private reclaimMap = new ReclaimMap();

  // Client ID storage key prefix
  private static readonly CLIENT_ID_PREFIX = 'singaporean-multiplayer.client-id.';

  /** Get or create a persistent client ID for this peer (stored in localStorage). */
  private getOrCreateClientId(): string {
    const key = `${PeerJsBroker.CLIENT_ID_PREFIX}${this.roomKey}`;
    let clientId = localStorage.getItem(key);
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem(key, clientId);
    }
    return clientId;
  }

  /** Map from persistent client ID to ephemeral PeerJS ID. */
  private clientIdToPeerId = new Map<string, string>();

  /** Map from ephemeral PeerJS ID to persistent client ID. */
  private peerIdToClientId = new Map<string, string>();

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
      // Send persistent client ID to host so seat can be reclaimed on refresh
      conn.on('open', () => {
        const clientId = this.getOrCreateClientId();
        conn.send({ type: 'CLIENT_ID', data: { clientId } });
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
        // Guard: if a connection from this peerId is already open, close the
        // stale one. PeerJS may re-deliver a stale connection event if the
        // signaling server held a reference to the old Peer ID.
        const existingConn = this.connections.get(peerId);
        if (existingConn && existingConn !== conn && existingConn.open) {
          console.warn(`Host: closing stale connection to ${peerId}, accepting new one`);
          existingConn.close();
          this.connections.delete(peerId);
        }
        if (!this.connections.has(peerId)) {
          this.connections.set(peerId, conn);
        }

        const now = Date.now();
        const reclaimedSeat = this.reclaimMap.reconnSeat(peerId, now);
        
        let seat: PlayerIndex;
        if (reclaimedSeat !== null) {
          seat = reclaimedSeat;
          this.reclaimMap.set(peerId, seat, now);
        } else {
          if (!this.arrivalOrder.has(peerId)) {
            this.arrivalOrder.set(peerId, this.nextArrivalPosition++);
          }
          seat = this.assignSeat(peerId);
          // Guard: if the assigned seat is already occupied by another peer, 
          // find the next available seat (0..3). This prevents two peers from
          // getting the same seat due to modulo wrapping.
          let collisionCount = 0;
          const maxAttempts = 10;
          // Check if the computed seat is occupied by ANY other peer
          while (collisionCount < maxAttempts) {
            const occupiedByAnother = Array.from(this.seatMap.entries()).some(
              ([otherId, s]) => otherId !== peerId && s === seat
            );
            if (occupiedByAnother) {
              // Find the next available seat
              const attempted = (++this.nextArrivalPosition - 1) % 4;
              seat = attempted as PlayerIndex;
              collisionCount++;
            } else {
              break;
            }
          }
          this.reclaimMap.set(peerId, seat, now);
        }
        
        this.seatMap.set(peerId, seat);

        const assignmentFrame: Frame = {
          type: 'PLAYER_ASSIGNMENT',
          data: { seat, peerId },
        };

        for (const [, existingConn] of this.connections) {
          if (existingConn.open) {
            existingConn.send(assignmentFrame);
          }
        }

        if (conn.open) {
          conn.send(assignmentFrame);
        }

        this.onPeerConnectCb?.(peerId, seat);
        this.onPeerReadyCb?.({ peerId, seat });
      } else {
        // Peer mode: wait for PLAYER_ASSIGNMENT from host
      }
    });

    conn.on('data', (data: any) => {
      const frame = data as Frame;
      if (frame.type === 'CLIENT_ID' && this.isHost) {
        // Handle persistent client ID from peer - map it to ephemeral PeerJS ID
        const clientData = frame.data as { clientId: string };
        const clientId = clientData.clientId;
        this.clientIdToPeerId.set(clientId, peerId);
        this.peerIdToClientId.set(peerId, clientId);
        
        // Check if this client ID had a previous seat assignment
        const oldPeerId = this.clientIdToPeerId.get(clientId);
        if (oldPeerId && oldPeerId !== peerId) {
          // This is a returning client - reclaim their seat
          const oldSeat = this.seatMap.get(oldPeerId);
          if (oldSeat !== undefined) {
            // Transfer seat assignment to new peerId
            this.seatMap.set(peerId, oldSeat);
            // Update reclaimMap with new peerId
            this.reclaimMap.set(peerId, oldSeat, Date.now());
            // Clean up old mappings
            this.seatMap.delete(oldPeerId);
            this.arrivalOrder.set(peerId, this.arrivalOrder.get(oldPeerId) ?? this.nextArrivalPosition++);
            this.arrivalOrder.delete(oldPeerId);
            this.peerIdToClientId.set(peerId, clientId);
            this.peerIdToClientId.delete(oldPeerId);
          }
        }
      } else if (frame.type === 'PLAYER_ASSIGNMENT' && !this.isHost) {
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

  onPeerConnect(cb: (peerId: string, seat: PlayerIndex) => void): void {
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
    // Keep the Peer object alive after disconnect so its PeerID is released
    // back to the signaling server gracefully, avoiding "ID is taken" on
    // immediate reconnect. The connections are already closed above.
    // peer.destroy() is deferred; call destroy() on page unload or tab close.
  }

  /** Get the seat assigned to a peer (host mode only). */
  getSeat(peerId: string): PlayerIndex | undefined {
    return this.seatMap.get(peerId);
  }
}