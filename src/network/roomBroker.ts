/**
 * Room broker bridge for the multiplayer game hook.
 *
 * `signaling.ts` exposes the `IBroker` contract (room creation and joining),
 * while `transport.ts` consumes the richer `TransportBroker` contract (which
 * additionally models ordered per-player command channels). This module
 * bridges the two so the app can hand a concrete broker to `useGame` without
 * duplicating room-lifecycle logic.
 *
 * Room creation and joining are delegated to an `IBroker`. The player-channel
 * methods (peer connect/disconnect, inbound frames, delivery, and seating) are
 * wired to the underlying broker once a real transport-capable broker is
 * provided; a plain `IBroker` exposes only room lifecycle, so the channel
 * methods are explicit no-ops with a visible seam for that future wiring.
 */
import { makeBroker, type IBroker } from './signaling';
import type { TransportBroker } from './transport';

/**
 * Build a {@link TransportBroker} backed by an {@link IBroker} room lifecycle.
 * Pass the result as the `broker` option to `useGame`.
 */
export function makeTransportBroker(
  broker: IBroker = makeBroker(),
): TransportBroker {
  return {
    createRoom: () => broker.createRoom(),
    connect: (roomKey) => broker.connect(roomKey),

    // Room lifecycle comes from the IBroker above. The player-channel methods
    // below model ordered per-player transport; they are no-ops for a plain
    // IBroker and are wired to a real broker as transport infrastructure lands.
    onPeerConnect() {},
    onPeerDisconnect() {},
    onInboundFrame() {},
    async deliverToPeer() {},
    onPeerReady() {},
    async sendToPeer() {},
    disconnect() {},
  };
}

/** Guard used to confirm a value exposes the IBroker room-lifecycle shape. */
export function isIBroker(value: unknown): value is IBroker {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as IBroker).createRoom === 'function' &&
    typeof (value as IBroker).connect === 'function'
  );
}
