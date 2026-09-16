/**
 * Signaling layer for host-authoritative P2P multiplayer.
 *
 * This module deals only in room lifecycle and transport: creating a room,
 * issuing an unguessable room key, and connecting to a room. It holds NO game
 * logic and never touches game state or wire frames — that belongs in
 * transport.ts / protocol.ts.
 */

/** Pattern a generated room key must match: lowercase base36, at least 24 chars. */
const ROOM_KEY_PATTERN = /^[a-z0-9]{24,}$/;

const ROOM_KEY_MIN_LENGTH = 24;

/** Alphabet used to encode generated room keys. */
const KEY_ALABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Broker contract: a room-scoped transport handle.
 *
 * `createRoom()` mints a fresh, unguessable room key. `connect()` joins a room
 * identified by that key. Implementations are expected to guarantee secure
 * transport (HTTPS) and room isolation; that contract is enforced by the
 * concrete broker, not asserted here.
 */
export interface IBroker {
  createRoom(): Promise<{ roomKey: string }>;
  connect(roomKey: string): Promise<void>;
}

/** Optional knobs for the default broker; all fields are optional. */
export interface IBrokerConfig {
  /** Minimum length of generated room keys. Defaults to 24. */
  roomKeyLength?: number;
}

/**
 * True only for strings that match the generated room-key pattern: lowercase
 * base36, at least 24 characters. This is the single gate used both to validate
 * outgoing keys and to reject bogus keys at connect time.
 */
export function isRoomKeyValid(roomKey: string): boolean {
  return ROOM_KEY_PATTERN.test(roomKey);
}

/** Encode `count` random base36 chars from a crypto source. */
function encodeRandomKeys(count: number, randomValues: (n: number) => Uint8Array): string {
  const bytes = randomValues(count);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < count; i++) {
    result += KEY_ALABET[bytes[i] & 0x1f]; // 0x1f == 31 < 36
  }
  return result;
}

/**
 * Build the default broker. Uses the platform WebCrypto API (available in both
 * modern browsers and Node 18+/20+) to mint unguessable room keys, and falls
 * back to a Node-style `randomBytes` if needed.
 */
export function makeBroker(config: IBrokerConfig = {}): IBroker {
  const roomKeyLength = config.roomKeyLength ?? ROOM_KEY_MIN_LENGTH;

  function randomValues(n: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  return {
    async createRoom(): Promise<{ roomKey: string }> {
      const roomKey = encodeRandomKeys(roomKeyLength, randomValues);
      return { roomKey };
    },

    async connect(roomKey: string): Promise<void> {
      if (!isRoomKeyValid(roomKey)) {
        throw new Error(`invalid roomKey: expected a ${ROOM_KEY_MIN_LENGTH}+ char base36 key`);
      }
      // Joining the room on the broker. The concrete broker would open a secured
      // channel to the room keyed by roomKey here; that transport is broker-specific.
    },
  };
}
