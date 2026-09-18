// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Frame, TransportBroker } from '../src/network/transport';
import type { PlayerIndex } from '../src/engine/types';
import { useGame } from '../src/hooks/useGame';

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A minimal stub broker whose `createRoom()` rejects after a short delay,
 * modeling the PeerJS signaling `open` timeout. Everything else is a no-op so
 * the transport can be constructed and torn down without a real network.
 */
class RejectingBroker implements TransportBroker {
  private createRoomRejectAfterMs: number;
  constructor(rejectAfterMs = 10) {
    this.createRoomRejectAfterMs = rejectAfterMs;
  }
  createRoom(): Promise<{ roomKey: string }> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('PeerJS signaling connection timed out')),
        this.createRoomRejectAfterMs,
      );
    });
  }
  async connect(_roomKey: string): Promise<void> {}
  onPeerConnect(_cb: (peerId: string) => void): void {}
  onPeerDisconnect(_cb: (peerId: string) => void): void {}
  onInboundFrame(_cb: (peerId: string, frame: Frame) => void): void {}
  async deliverToPeer(_peerId: string, _frame: Frame): Promise<void> {}
  onPeerReady(_cb: (info: { peerId: string; seat: PlayerIndex }) => void): void {}
  async sendToPeer(_frame: Frame): Promise<void> {}
  disconnect(): void {}
}

/**
 * Host-mode harness mirroring App.tsx's GameHost error screen: it renders the
 * "Connection failed" text exactly when the hook reports a connection error.
 */
function HostHarness({ broker }: { broker: TransportBroker }) {
  const game = useGame({ roomKey: 'test-room', isHost: true, broker });
  if (game.connectionError) {
    return (
      <div data-testid="error-screen">
        <p>Connection failed</p>
        <p>{game.connectionError}</p>
      </div>
    );
  }
  return <div data-testid="table" />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
});

describe('useGame - connection error surface (regression)', () => {
  it('shows the Connection failed screen when the host broker createRoom rejects', async () => {
    const broker = new RejectingBroker(10);
    await act(async () => {
      root.render(<HostHarness broker={broker} />);
    });
    // The broker rejects ~10ms after the transport init promise is fired; let
    // that rejection, the buffered replay, and the re-render settle.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(container.querySelector('[data-testid="error-screen"]')).not.toBeNull();
    expect(container.textContent).toContain('Connection failed');
    expect(container.textContent).toContain('PeerJS signaling connection timed out');
  });

  it('shows the error even when the rejection lands before the error subscriber attaches', async () => {
    // Reject on the very next tick so the init .catch runs before useGame's
    // [transport] effect has a chance to attach its onError handler.
    const broker = new RejectingBroker(0);
    await act(async () => {
      root.render(<HostHarness broker={broker} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(container.querySelector('[data-testid="error-screen"]')).not.toBeNull();
    expect(container.textContent).toContain('Connection failed');
  });
});
