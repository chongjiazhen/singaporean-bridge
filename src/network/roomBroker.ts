/**
 * Room broker bridge for the multiplayer game hook.
 *
 * This module wires the PeerJS managed broker (PeerServer Cloud) to the
 * TransportBroker contract used by the game. It is the single wiring seam
 * between the app and the transport layer.
 */
import { PeerJsBroker } from './peerjs-broker';
import type { TransportBroker } from './transport';
import type { PlayerIndex } from '../engine/types';

/**
 * Build a {@link TransportBroker} backed by PeerJS managed broker.
 * Pass the result as the `broker` option to `useGame`.
 */
export function makeTransportBroker(
  roomKey: string,
  isHost: boolean,
  hostSeat: PlayerIndex = 0,
): TransportBroker {
  return new PeerJsBroker({ roomKey, isHost, hostSeat });
}

/** Guard used to confirm a value exposes the TransportBroker shape. */
export function isTransportBroker(value: unknown): value is TransportBroker {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TransportBroker).createRoom === 'function' &&
    typeof (value as TransportBroker).connect === 'function' &&
    typeof (value as TransportBroker).onPeerConnect === 'function' &&
    typeof (value as TransportBroker).onPeerDisconnect === 'function' &&
    typeof (value as TransportBroker).onInboundFrame === 'function' &&
    typeof (value as TransportBroker).deliverToPeer === 'function' &&
    typeof (value as TransportBroker).onPeerReady === 'function' &&
    typeof (value as TransportBroker).sendToPeer === 'function' &&
    typeof (value as TransportBroker).disconnect === 'function'
  );
}
