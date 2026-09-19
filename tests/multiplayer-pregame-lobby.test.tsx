// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGame } from '../src/hooks/useGame';
import { InMemoryBroker } from '../src/network/transport';
import type { UseGameReturn } from '../src/hooks/useGame';

const tick = () => new Promise((r) => setTimeout(r, 0));

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
  container.remove();
});

/**
 * The "Host a game" flow: App.tsx calls
 * `useGame({ isHost: true, waitForPeers: true })`. The bug that regressed was
 * that `useGame` did NOT forward `waitForPeers` to `makeTransport`, so the host
 * started the auction (and bots) on room creation instead of waiting in the
 * DEALING lobby. This test asserts the hook keeps the host in DEALING until it
 * calls handleStartGame.
 */
describe('useGame host pre-game lobby', () => {
  it('host with waitForPeers=true stays in DEALING until handleStartGame', async () => {
    const broker = new InMemoryBroker();
    const ref = { current: null as UseGameReturn | null };
    function Probe() {
      ref.current = useGame({ roomKey: 'lobby-hook', isHost: true, broker, waitForPeers: true });
      return null as ReactNode | null;
    }
    await act(async () => {
      root.render(<Probe />);
      await tick();
    });
    const api = ref.current!;

    // The host must be waiting in the DEALING lobby, not auctioning yet.
    expect(api.state.phase).toBe('DEALING');
    expect(api.canStartGame).toBe(true);

    act(() => { api.handleStartGame(); });
    await act(async () => { await tick(); });

    expect(ref.current!.state.phase).toBe('AUCTION');
  });

  it('host WITHOUT waitForPeers starts the auction immediately (canStartGame false)', async () => {
    const broker = new InMemoryBroker();
    const ref = { current: null as UseGameReturn | null };
    function Probe() {
      ref.current = useGame({ roomKey: 'instant-hook', isHost: true, broker });
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await tick();
    });

    expect(ref.current!.state.phase).toBe('AUCTION');
    expect(ref.current!.canStartGame).toBe(false);
  });
});
