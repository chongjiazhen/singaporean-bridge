/**
 * Peer layer for host-authoritative P2P multiplayer.
 *
 * Transport-only: this module handles seat persistence, seat reclamation on
 * reconnect, and deterministic seat assignment. It performs NO game logic and
 * never reads or mutates game state.
 */
import { canonicalize } from './protocol';
import type { PlayerIndex } from '../engine/types';

/** Storage key prefix for remembered seats, keyed by room key. */
export const SEASTORAGE_PREFIX = 'singaporean-multiplayer.seat.';

/** Builds the sessionStorage key for a remembered seat. */
export function seatStorageKey(roomKey: string): string {
  return `${SEASTORAGE_PREFIX}${roomKey}`;
}

/** Persists a seat for a room in sessionStorage (session-scoped). */
export function rememberSeat(roomKey: string, seat: PlayerIndex): void {
  const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (!storage) return;
  storage.setItem(seatStorageKey(roomKey), JSON.stringify(seat));
}

/** Reads a remembered seat for a room, or null if absent/invalid. */
export function readSeat(roomKey: string): PlayerIndex | null {
  const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (!storage) return null;
  const raw = storage.getItem(seatStorageKey(roomKey));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const seat = canonicalize(parsed) as PlayerIndex;
  return (seat === 0 || seat === 1 || seat === 2 || seat === 3) ? seat : null;
}

/** Window (ms) within which a connection's seat can be reclaimed on reconnect. */
export const RECONNECT_WINDOW_MS = 45000;

interface ReclaimEntry {
  seat: PlayerIndex;
  lastSeen: number;
}

/**
 * Tracks connections and the seats they may reclaim on reconnect. Entries expire
 * after `RECONNECT_WINDOW_MS`.
 */
export class ReclaimMap {
  private map = new Map<string, ReclaimEntry>();

  /** Record a connection's current seat at time `now`. */
  set(connId: string, seat: PlayerIndex, now: number): void {
    this.map.set(connId, { seat, lastSeen: now });
  }

  /**
   * Returns the seat for `connId` while the entry is still within the reconnect
   * window; null once expired or unknown.
   */
  get(connId: string, now: number): PlayerIndex | null {
    const entry = this.map.get(connId);
    if (!entry) return null;
    if (now - entry.lastSeen > RECONNECT_WINDOW_MS) {
      this.map.delete(connId);
      return null;
    }
    return entry.seat;
  }

  /** Alias of {@link get}: reclaim a connection's seat within the window. */
  reconnSeat(connId: string, now: number): PlayerIndex | null {
    return this.get(connId, now);
  }

  /** Drops all tracked entries. */
  clear(): void {
    this.map.clear();
  }
}

/**
 * Assigns seats to connections by arrival order.
 *
 * `arrivalOrder` maps connId -> arrival position (1-based, 1 = first joined).
 * seat = (hostSeat + arrivalPosition) % 4. Ties (same arrival position) are
 * broken deterministically by lexicographically smaller connId.
 */
export function assignSeat(
  hostSeat: PlayerIndex,
  arrivalOrder: Map<string, number>
): Map<string, PlayerIndex> {
  const result = new Map<string, PlayerIndex>();
  if (arrivalOrder.size === 0) return result;

  const sorted = [...arrivalOrder].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  sorted.forEach(([connId, _arrival], index) => {
    const arrivalPosition = index + 1;
    const seat = ((hostSeat + arrivalPosition) % 4) as PlayerIndex;
    result.set(connId, seat);
  });

  return result;
}
