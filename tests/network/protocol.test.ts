import { describe, it, expect } from 'vitest';
import type { Card, Strain, PlayerIndex } from '../src/engine/types';
import {
  FrameType,
  Frame,
  serializeFrame,
  deserializeFrame,
  isInboundCommandType,
  canonicalize,
} from '../src/network/protocol';

/** A minimal card shape for payloads. */
const sampleCard: Card = { rank: 'SH', suit: 'RED', value: 1 } as Card;

describe('serializeFrame / deserializeFrame round-trip', () => {
  it('round-trips a BID frame', () => {
    const frame: Frame = { type: 'BID', data: { level: 3, strain: 'RED' as Strain } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips a CALL_PARTNER frame', () => {
    const frame: Frame = { type: 'CALL_PARTNER', data: { card: sampleCard } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips a PLAY_CARD frame', () => {
    const frame: Frame = { type: 'PLAY_CARD', data: { card: sampleCard } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips a GAME_STATE frame', () => {
    const frame: Frame = { type: 'GAME_STATE', data: { phase: 'AUCTION', n: 4 } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips a PLAYER_ASSIGNMENT frame', () => {
    const frame: Frame = { type: 'PLAYER_ASSIGNMENT', data: { seat: 1 as PlayerIndex, peerId: 'abc' } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips an ERROR frame with a nested payload', () => {
    const frame: Frame = { type: 'ERROR', data: { reason: 'illegal', commandId: 5 } };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('handles deeply nested data payloads', () => {
    const payload = { a: { b: { c: [1, 2, { d: 'x' }] } }, e: null };
    const frame: Frame = { type: 'GAME_STATE', data: payload };
    const out = serializeFrame(frame);
    expect(deserializeFrame(out)).toEqual(frame);
  });

  it('round-trips string and number scalar payloads', () => {
    const str = { type: 'ERROR', data: 'boom' };
    const num = { type: 'GAME_STATE', data: 42 };
    expect(deserializeFrame(serializeFrame(str))).toEqual(str);
    expect(deserializeFrame(serializeFrame(num))).toEqual(num);
  });
});

describe('deserializeFrame rejects malformed input', () => {
  it('throws on empty string', () => {
    expect(() => deserializeFrame('')).toThrow();
  });

  it('throws on malformed JSON', () => {
    expect(() => deserializeFrame('{oops')).toThrow();
  });

  it('throws when type is missing', () => {
    expect(() => deserializeFrame(JSON.stringify({ data: {} }))).toThrow();
  });

  it('throws when type is not a string', () => {
    expect(() => deserializeFrame(JSON.stringify({ type: 7, data: {} }))).toThrow();
  });

  it('throws when type is an unknown frame type', () => {
    expect(() => deserializeFrame(JSON.stringify({ type: 'NOPE', data: {} }))).toThrow();
  });
});

describe('isInboundCommandType', () => {
  it('is true for the three inbound command types', () => {
    expect(isInboundCommandType('BID')).toBe(true);
    expect(isInboundCommandType('CALL_PARTNER')).toBe(true);
    expect(isInboundCommandType('PLAY_CARD')).toBe(true);
  });

  it('is false for non-command frame types', () => {
    expect(isInboundCommandType('GAME_STATE')).toBe(false);
    expect(isInboundCommandType('PLAYER_ASSIGNMENT')).toBe(false);
    expect(isInboundCommandType('ERROR')).toBe(false);
  });

  it('is false for unknown types', () => {
    expect(isInboundCommandType('BOGUS')).toBe(false);
    expect(isInboundCommandType('')).toBe(false);
    expect(isInboundCommandType('bid')).toBe(false);
  });
});

describe('canonicalize', () => {
  it('returns a deep-equal clone of a nested object', () => {
    const input = { a: 1, nested: { b: 2, arr: [3, 4, { c: 5 }] } };
    const out = canonicalize(input);
    expect(out).toEqual(input);
  });

  it('preserves null', () => {
    const input = { x: null };
    expect(canonicalize(input)).toEqual({ x: null });
  });

  it('preserves nested arrays', () => {
    const input = { list: [1, 'two', { three: 3 }, null] };
    expect(canonicalize(input)).toEqual(input);
  });

  it('returns a new reference (clones, does not alias)', () => {
    const input = { a: 1 };
    const out = canonicalize(input);
    expect(out).not.toBe(input);
  });

  it('does not mutate the original when nested objects change', () => {
    const input = { nested: { a: 1 } };
    const out = canonicalize(input);
    (out as { nested: { a: number } }).nested.a = 999;
    expect(input.nested.a).toBe(1);
  });
});
