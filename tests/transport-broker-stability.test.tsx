// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGame } from '../src/hooks/useGame';
import type { Transport, TransportBroker } from '../src/network/transport';

const tick = () => new Promise((r) => setTimeout(r, 0));

// Stub transport returned by the mocked makeTransport: satisfies the Transport
// shape just enough for useGame to store it.
const stubTransport = {
  seat: 0,
  isHost: true,
  onGameState: () => {},
  onPeerAssigned: () => {},
  onError: () => {},
  onCommand: () => {},
  sendBid: () => {},
  sendCallPartner: () => {},
  sendPlayCard: () => {},
  sendPass: () => {},
  destroy: () => {},
} as unknown as Transport;

/**
 * A broker factory that counts constructions. Each call returns a fresh stub
 * broker, so the construction count equals the number of distinct broker
 * instances ever handed to the hook.
 */
function makeCountingBrokerFactory() {
  let constructions = 0;
  const factory = () => {
    constructions += 1;
    const noop = () => {};
    return {
      createRoom: async () => ({ roomKey: 'test-room' }),
      connect: async () => {},
      onPeerConnect: noop,
      onPeerDisconnect: noop,
      onInboundFrame: noop,
      deliverToPeer: async () => {},
      onPeerReady: noop,
      sendToPeer: async () => {},
      disconnect: noop,
    } satisfies TransportBroker;
  };
  return { factory, constructions: () => constructions };
}

function HostHarness({ broker }: { broker: TransportBroker }) {
  useGame({ roomKey: 'test-room', isHost: true, broker });
  return <div data-testid="host" />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  window.location.hash = '';
  vi.unstubAllGlobals();
  container.remove();
});

describe('useGame broker stability (015)', () => {
  it('constructs the transport exactly once per host mount, not once per render', async () => {
    const makeTransportSpy = vi
      .spyOn(await import('../src/network/transport'), 'makeTransport')
      .mockImplementation(() => Promise.resolve(stubTransport));

    // Stable broker (what App.tsx produces via useMemo): the hook must build
    // the transport exactly once across repeated renders of the host view.
    const { factory } = makeCountingBrokerFactory();
    const broker = factory();

    await act(async () => {
      root.render(<HostHarness broker={broker} />);
    });
    await tick();
    // Force repeated renders (what an unstable dep would keep doing).
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        root.render(<HostHarness broker={broker} />);
      });
    }
    await tick();

    expect(makeTransportSpy).toHaveBeenCalledTimes(1);
  });

  it('the host view re-renders without re-constructing its broker or transport', async () => {
    // Mutation check for the real component: render the actual App as a
    // mounted host. If GameHost ever calls makeTransportBroker in the
    // component body again (a fresh broker ref per render), the counting
    // factory below sees more than one construction and the test fails.
    window.location.hash = 'join/015-mutation-room';

    const { factory, constructions } = makeCountingBrokerFactory();
    const makeTransportSpy = vi
      .spyOn(await import('../src/network/transport'), 'makeTransport')
      .mockImplementation(() => Promise.resolve(stubTransport));
    vi.spyOn(await import('../src/network/roomBroker'), 'makeTransportBroker')
      .mockImplementation(factory);
    // GameSolo's create path mints a room via signaling; keep it offline.
    vi.spyOn(await import('../src/network/signaling'), 'makeBroker')
      .mockImplementation(() => ({
        createRoom: async () => ({ roomKey: '015-mutation-room' }),
        destroy: () => {},
      }));

    const { default: App } = await import('../src/App');
    await act(async () => {
      root.render(<App />);
    });
    await tick();
    // Force extra renders of the mounted host view.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        root.render(<App />);
      });
    }
    await tick();

    // One broker for the mount, one transport for the mount - no loop.
    expect(constructions()).toBe(1);
    expect(makeTransportSpy).toHaveBeenCalledTimes(1);
  });

  it('a per-render (unstable) broker re-creates the transport every render', async () => {
    const makeTransportSpy = vi
      .spyOn(await import('../src/network/transport'), 'makeTransport')
      .mockImplementation(() => Promise.resolve(stubTransport));

    const { factory, constructions } = makeCountingBrokerFactory();
    const renderCounts: number[] = [];
    const UnstableHost = () => {
      // Bug pattern: a fresh broker in the component body, new ref each render.
      renderCounts.push(1);
      return <HostHarness broker={factory()} />;
    };

    await act(async () => {
      root.render(<UnstableHost />);
    });
    await tick();
    await act(async () => {
      root.render(<UnstableHost />);
    });
    await tick();
    await act(async () => {
      root.render(<UnstableHost />);
    });
    await tick();

    // The mutation check: with an unstable broker ref the effect re-runs on
    // every render, so the transport is rebuilt each time instead of once.
    expect(renderCounts.length).toBe(3);
    expect(constructions()).toBe(3);
    expect(makeTransportSpy).toHaveBeenCalledTimes(3);
  });
});
