import { describe, it, expect } from 'vitest';
import type { IBroker } from '../src/network/signaling';
import { makeBroker, isRoomKeyValid } from '../src/network/signaling';

const BASE36 = /^[a-z0-9]+$/;
const LONG_KEY = 'a'.repeat(24);
const LONGER_KEY = 'b'.repeat(40);

/** Generate a base36 key by hand from a fixed seed, independent of code under test. */
function handMadeKey(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[i % alphabet.length];
  }
  return out;
}

describe('isRoomKeyValid', () => {
  it('accepts a valid 24-char base36 key', () => {
    const key = handMadeKey(24);
    expect(BASE36.test(key)).toBe(true);
    expect(key.length).toBe(24);
    expect(isRoomKeyValid(key)).toBe(true);
  });

  it('rejects a key shorter than 24 chars', () => {
    expect(isRoomKeyValid('a'.repeat(23))).toBe(false);
    expect(isRoomKeyValid('')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isRoomKeyValid('A'.repeat(24))).toBe(false);
    expect(isRoomKeyValid('Ab'.repeat(12))).toBe(false);
  });

  it('rejects spaces and non-alphanumeric characters', () => {
    expect(isRoomKeyValid(' '.repeat(24))).toBe(false);
    expect(isRoomKeyValid(`${'a'.repeat(12)} ${'a'.repeat(11)}`)).toBe(false);
    expect(isRoomKeyValid('a'.repeat(23) + '_')).toBe(false);
  });
});

describe('makeBroker().createRoom()', () => {
  it('returns a roomKey that is at least 24 chars and all base36', async () => {
    const broker = makeBroker();
    const { roomKey } = await broker.createRoom();
    expect(roomKey.length).toBeGreaterThanOrEqual(24);
    expect(BASE36.test(roomKey)).toBe(true);
    expect(isRoomKeyValid(roomKey)).toBe(true);
  });

  it('honors a configured longer roomKey length', async () => {
    const broker = makeBroker({ roomKeyLength: 48 });
    const { roomKey } = await broker.createRoom();
    expect(roomKey.length).toBe(48);
    expect(BASE36.test(roomKey)).toBe(true);
    expect(isRoomKeyValid(roomKey)).toBe(true);
  });

  it('returns different roomKeys across calls', async () => {
    const broker = makeBroker();
    const { roomKey: k1 } = await broker.createRoom();
    const { roomKey: k2 } = await broker.createRoom();
    expect(k1).not.toBe(k2);
  });

  it('never returns a UUID-like value', async () => {
    const broker = makeBroker();
    const uuidRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (let i = 0; i < 8; i++) {
      const { roomKey } = await broker.createRoom();
      expect(uuidRE.test(roomKey)).toBe(false);
      expect(isRoomKeyValid(roomKey)).toBe(true);
    }
  });
});

describe('makeBroker().connect()', () => {
  it('resolves for a valid roomKey', async () => {
    const broker = makeBroker();
    await expect(broker.connect(handMadeKey(30))).resolves.toBeUndefined();
  });

  it('throws for a too-short roomKey', async () => {
    const broker = makeBroker();
    await expect(broker.connect('a'.repeat(10))).rejects.toBeTruthy();
  });

  it('throws for an uppercase roomKey', async () => {
    const broker = makeBroker();
    await expect(broker.connect('A'.repeat(24))).rejects.toBeTruthy();
  });

  it('throws for an empty roomKey', async () => {
    const broker = makeBroker();
    await expect(broker.connect('')).rejects.toBeTruthy();
  });
});

describe('two brokers', () => {
  it('each broker works independently', async () => {
    const a = makeBroker();
    const b = makeBroker();

    const { roomKey: ra } = await a.createRoom();
    const { roomKey: rb } = await b.createRoom();

    await expect(brokerConnect(a, ra)).resolves.toBeUndefined();
    await expect(brokerConnect(b, rb)).resolves.toBeUndefined();
    expect(ra).not.toBe(rb);
  });
});

function brokerConnect(broker: IBroker, roomKey: string): Promise<void> {
  return broker.connect(roomKey);
}
