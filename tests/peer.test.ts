import { describe, it, expect } from 'vitest';
import type { PlayerIndex } from '../engine/types';
import {
  SEASTORAGE_PREFIX,
  seatStorageKey,
  rememberSeat,
  readSeat,
  RECONNECT_WINDOW_MS,
  ReclaimMap,
  assignSeat,
} from '../src/network/peer';

/** Minimal sessionStorage shim for Node/vitest. Set before anything touches it. */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as any).sessionStorage = new MemStorage();

function keyFor(roomKey: string): string {
  return seatStorageKey(roomKey);
}

describe('seatStorageKey', () => {
  it('uses the documented constant prefix', () => {
    expect(SEASTORAGE_PREFIX).toBe('singaporean-multiplayer.seat.');
  });

  it('returns prefix concatenated with roomKey', () => {
    expect(keyFor('room-xyz')).toBe('singaporean-multiplayer.seat.room-xyz');
  });
});

describe('rememberSeat / readSeat', () => {
  it('round-trips a seat through sessionStorage', () => {
    rememberSeat('room-1', 2 as PlayerIndex);
    expect(readSeat('room-1')).toBe(2);
  });

  it('returns null when absent', () => {
    expect(readSeat('room-does-not-exist')).toBeNull();
  });

  it('returns null when the stored value is malformed', () => {
    sessionStorage.setItem(keyFor('room-bad'), 'not-a-number');
    expect(readSeat('room-bad')).toBeNull();
  });
});

describe('ReclaimMap', () => {
  it('returns the seat while within the reconnect window', () => {
    const map = new ReclaimMap();
    map.set('conn-1', 1 as PlayerIndex, 1000);
    expect(map.get('conn-1', 1000 + RECONNECT_WINDOW_MS)).toBe(1);
  });

  it('returns null once now exceeds lastSeen + window', () => {
    const map = new ReclaimMap();
    map.set('conn-1', 1 as PlayerIndex, 1000);
    expect(map.get('conn-1', 1000 + RECONNECT_WINDOW_MS + 1)).toBeNull();
  });

  it('returns null for an unknown connection', () => {
    const map = new ReclaimMap();
    expect(map.get('no-such-conn', 1000)).toBeNull();
  });

  it('reconnSeat mirrors get: seat within window, null after', () => {
    const map = new ReclaimMap();
    map.set('conn-2', 2 as PlayerIndex, 5000);
    expect(map.reconnSeat('conn-2', 5000)).toBe(2);
    expect(map.reconnSeat('conn-2', 5000 + RECONNECT_WINDOW_MS + 100)).toBeNull();
  });

  it('clear drops all entries', () => {
    const map = new ReclaimMap();
    map.set('conn-3', 3 as PlayerIndex, 1000);
    map.clear();
    expect(map.get('conn-3', 1000)).toBeNull();
  });
});

describe('assignSeat', () => {
  it('assigns (hostSeat + arrivalPosition) % 4', () => {
    const arrival = new Map<string, number>([['a-conn', 1], ['b-conn', 2]]);
    const result = assignSeat(0 as PlayerIndex, arrival);
    expect(result.get('a-conn')).toBe((0 + 1) % 4);
    expect(result.get('b-conn')).toBe((0 + 2) % 4);
  });

  it('is deterministic on ties via lexicographic connId', () => {
    const arrival = new Map<string, number>([['b-conn', 1], ['a-conn', 1]]);
    const result = assignSeat(0 as PlayerIndex, arrival);
    // tie broken lexicographically: a-conn gets position 1, b-conn position 2.
    expect(result.get('a-conn')).toBe(1);
    expect(result.get('b-conn')).toBe(2);
  });

  it('returns an empty map for empty input', () => {
    const result = assignSeat(1 as PlayerIndex, new Map<string, number>());
    expect(result.size).toBe(0);
  });
});
