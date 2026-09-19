// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';
import { GameTable } from '../src/components/GameTable';
import type { Card, GameState, PlayerIndex } from '../src/engine/types';
import { DEFAULT_RULES } from '../src/engine/types';
import { createInitialState } from '../src/engine/gameEngine';

let container: HTMLDivElement;
let root: Root;

const noop = () => {};

/** Mount a DEALING GameTable with the given overrides (share-link fix surface). */
function renderDealing(overrides: Partial<Parameters<typeof GameTable>[0]> = {}) {
  const state: GameState = createInitialState(0, DEFAULT_RULES); // DEALING phase
  const humanHand = (state.hands[0] ?? []) as Card[];
  act(() => {
    root.render(
      <GameTable
        state={state}
        rules={state.rules}
        humanHand={humanHand}
        humanSeat={0 as PlayerIndex}
        legalPlays={[]}
        availableCallCards={[]}
        legalBids={[]}
        canPass={false}
        statusText=""
        isHumanTurn={false}
        onBid={noop}
        onPass={noop}
        onCallCard={noop}
        onPlayCard={noop}
        onOpenTutorial={noop}
        onCloseTutorial={noop}
        onNewHand={noop}
        onSetRules={noop}
        showTutorial={false}
        canStartGame={true}
        {...overrides}
      />,
    );
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom allows assigning the hash; reset between tests so deep-link parsing
  // is deterministic.
  window.location.hash = '';
});

afterEach(() => {
  window.location.hash = '';
  act(() => root.unmount());
  container.remove();
});

describe('Default entry screen (solo)', () => {
  it('renders the solo table with a "Host a game" button', async () => {
    await act(async () => {
      root.render(<App />);
    });

    // The solo table is live: the AuctionLog header ("Auction") is on screen.
    expect(container.textContent).toContain('Auction');

    // The host-invite button is present in the table header.
    const hostButton = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').includes('Host a game'),
    );
    expect(hostButton).toBeDefined();
  });

  it('the "Host a game" button navigates to a #host/ link', async () => {
    await act(async () => {
      root.render(<App />);
    });

    const hostButton = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').includes('Host a game'),
    );

    await act(async () => {
      hostButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Let onHost's async room-mint settle.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(window.location.hash.startsWith('#host/')).toBe(true);
  });
});

describe('Host share-link fix', () => {
  it('pure: replacing #host/ yields a #join/ invite URL', () => {
    const url =
      'https://chongjiazhen.github.io/singaporean-bridge/index.html#host/abcdefghij0123456789abcdef';
    const share = url.replace('#host/', '#join/');
    expect(share).toContain('#join/');
    expect(share).not.toContain('#host/');
  });

  it('rendered: a host in DEALING shares a #join link, not its own #host link', () => {
    window.location.hash = '#host/abcdefghij0123456789abcdef';
    renderDealing();

    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    const text = code?.textContent ?? '';
    expect(text).toContain('#join/');
    expect(text).not.toContain('#host/');
  });

  it('rendered: a peer DEALING URL is preserved (replace is a no-op)', () => {
    window.location.hash = '#join/abcdefghij0123456789abcdef';
    renderDealing({ canStartGame: false });

    const code = container.querySelector('code');
    const text = code?.textContent ?? '';
    expect(text).toContain('#join/');
  });
});
