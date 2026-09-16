/**
 * Wire protocol for host-authoritative P2P multiplayer.
 *
 * This module deals only in transport and frames. It holds NO game logic: it
 * cannot read or mutate `GameState`, cannot call engine reducers, and cannot
 * reason about legal commands. It encodes/decodes frames for a brokered
 * transport.
 */

/** Frame kinds carried on the wire. */
export type FrameType =
  | 'BID'
  | 'CALL_PARTNER'
  | 'PLAY_CARD'
  | 'GAME_STATE'
  | 'PLAYER_ASSIGNMENT'
  | 'ERROR';

/** A single transport frame: a type plus its frame-specific payload. */
export type Frame = {
  type: FrameType;
  data: unknown;
};

/** Inbound command frames that carry a player command (never state). */
const INBOUND_COMMAND_TYPES: readonly FrameType[] = ['BID', 'CALL_PARTNER', 'PLAY_CARD'];

const FRAME_TYPES: ReadonlySet<string> = new Set<string>([
  'BID', 'CALL_PARTNER', 'PLAY_CARD', 'GAME_STATE', 'PLAYER_ASSIGNMENT', 'ERROR',
]);

/** Serialize a frame to a lossless wire string. */
export function serializeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

/**
 * Inverse of {@link serializeFrame}. Throws on any malformed input rather than
 * silently returning garbage: bad JSON, a missing type, a non-string type, or an
 * unknown frame type.
 */
export function deserializeFrame(value: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('deserializeFrame: invalid JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('type' in parsed) ||
    typeof (parsed as { type: unknown }).type !== 'string'
  ) {
    throw new Error('deserializeFrame: missing or non-string type');
  }
  const type = (parsed as { type: string }).type;
  if (!FRAME_TYPES.has(type)) {
    throw new Error(`deserializeFrame: unknown frame type "${type}"`);
  }
  return parsed as Frame;
}

/** True only for the three inbound command frame kinds. */
export function isInboundCommandType(type: string): boolean {
  return (INBOUND_COMMAND_TYPES as readonly string[]).includes(type);
}

/**
 * Deep, JSON round-trip canonicalizer. Produces a fresh clone of `value` with
 * nested objects and arrays preserved and `null` retained. Deterministic for a
 * given input (no ordering guarantees beyond standard key order). Dates are out
 * of scope.
 */
export function canonicalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
