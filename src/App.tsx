import { useState, useCallback, useMemo, Component, type ReactNode } from 'react';
import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import { makeTransportBroker } from './network/roomBroker';
import { makeBroker, isRoomKeyValid } from './network/signaling';
import './index.css';

/**
 * Top-level error boundary. A render throw (e.g. a snapshot that arrives in a
 * shape the UI does not expect) used to blank the whole page; this recovers to a
 * reloadable screen instead so a single bad render does not kill the table.
 */
class GameErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Game render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-gray-200 p-4 text-center">
          <div>
            <p className="text-lg font-semibold mb-2">Something went wrong</p>
            <p className="text-sm text-gray-400 mb-4">The table hit an unexpected error.</p>
            <button
              onClick={() => { void window.location.reload(); }}
              className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Parse an invite key from `#join/<roomKey>`.
 *
 * A peer link looks like `https://.../index.html#join/<roomKey>`. Return the
 * room key, or `null` when there is no join intent in the current location.
 */
function parseJoinKey(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^#join\/(.*\S)$/.exec(window.location.hash);
  return match ? match[1] : null;
}

function parseHostKey(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^#host\/(.*\S)$/.exec(window.location.hash);
  return match ? match[1] : null;
}

/**
 * The game host. Renders the table driven by the transport in host mode.
 */
function GameHost({
  roomKey,
}: {
  roomKey: string;
}) {
  // Stable per mount: a fresh broker each render would re-key the transport
  // effect in useGame into a render loop. roomKey is fixed for the mount
  // (the key prop remounts on any change), so a one-time memo is safe.
  const broker = useMemo(() => makeTransportBroker(roomKey, true, 0), [roomKey]);
  const game = useGame({ roomKey, isHost: true, broker });

  if (game.connectionError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-red-300 p-4 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">Connection failed</p>
          <p className="text-sm text-gray-400">{game.connectionError}</p>
          <p className="text-xs text-gray-500 mt-3">Check your internet connection and reload.</p>
        </div>
      </div>
    );
  }

  return (
    <GameTable
      state={game.state}
      rules={game.rules}
      humanHand={game.state.hands[game.seat]}
      humanSeat={game.seat}
      legalPlays={game.legalPlays}
      availableCallCards={game.availableCallCards}
      legalBids={game.legalBids}
      canPass={game.canPass}
      statusText={game.statusText}
      isHumanTurn={game.isHumanTurn}
      pauseAfterTrick={game.pauseAfterTrick}
      awaitingContinue={game.awaitingContinue}
      onBid={game.handleHumanBid}
      onPass={game.handleHumanPass}
      onCallCard={game.handleHumanCallCard}
      onPlayCard={game.handleHumanPlayCard}
      onOpenTutorial={() => game.setShowTutorial(true)}
      onCloseTutorial={() => game.setShowTutorial(false)}
      onNewHand={game.handleNewHand}
      onSetRules={game.handleSetRules}
      onSetPauseAfterTrick={game.handleSetPauseAfterTrick}
      onContinue={game.handleContinue}
      showTutorial={game.showTutorial}
    />
  );
}

/**
 * The joining peer. Renders the table driven by the transport in peer mode:
 * it renders incoming GAME_STATE snapshots and forwards human actions back
 * toward the host. No local game logic.
 */
function GamePeer({
  roomKey,
}: {
  roomKey: string;
}) {
  // Stable per mount (see GameHost) so the transport effect's broker dep
  // does not churn on every render.
  const broker = useMemo(() => makeTransportBroker(roomKey, false), [roomKey]);
  const game = useGame({ roomKey, isHost: false, broker });

  if (game.connectionError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-red-300 p-4 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">Connection failed</p>
          <p className="text-sm text-gray-400">{game.connectionError}</p>
          <p className="text-xs text-gray-500 mt-3">Check your internet connection and reload.</p>
        </div>
      </div>
    );
  }

  return (
    <GameTable
      state={game.state}
      rules={game.rules}
      humanHand={game.state.hands[game.seat]}
      humanSeat={game.seat}
      legalPlays={game.legalPlays}
      availableCallCards={game.availableCallCards}
      legalBids={game.legalBids}
      canPass={game.canPass}
      statusText={game.statusText}
      isHumanTurn={game.isHumanTurn}
      pauseAfterTrick={game.pauseAfterTrick}
      awaitingContinue={game.awaitingContinue}
      onBid={game.handleHumanBid}
      onPass={game.handleHumanPass}
      onCallCard={game.handleHumanCallCard}
      onPlayCard={game.handleHumanPlayCard}
      onOpenTutorial={() => game.setShowTutorial(true)}
      onCloseTutorial={() => game.setShowTutorial(false)}
      onNewHand={game.handleNewHand}
      onSetRules={game.handleSetRules}
      onSetPauseAfterTrick={game.handleSetPauseAfterTrick}
      onContinue={game.handleContinue}
      showTutorial={game.showTutorial}
    />
  );
}

/**
 * The solo game. Renders the table plus a single "Create Game" button that
 * mints a room, appends its invite key to the location, and remounts the same
 * component instance as the host.
 */
function GameSolo() {
  const game = useGame();
  const [roomKey, setRoomKey] = useState<string | null>(null);

  const onCreate = useCallback(async () => {
    try {
      // Mint an unguessable room key via the signaling layer, then pass it to
      // the host broker as its fixed PeerJS id so peers can connect to it.
      // The key is issued exactly once here; the host (mounted on remount)
      // adopts it as its fixed PeerJS id. No throwaway broker echoes it.
      const { roomKey } = await makeBroker().createRoom();
      if (!isRoomKeyValid(roomKey)) {
        throw new Error('minted room key failed validation');
      }

      setRoomKey(roomKey);
      if (typeof window !== 'undefined') {
        window.location.hash = `host/${roomKey}`;
      }
    } catch (err) {
      console.error('Failed to create game', err);
    }
  }, []);

  // Remount on the new key swaps the hook variant cleanly (solo -> host) with a
  // fresh hook context, so React's hook-order invariant holds.
  if (roomKey) {
    return <GameHost key={`host-${roomKey}`} roomKey={roomKey} />;
  }

  return (
    <div key="solo">
      <GameTable
        state={game.state}
        rules={game.rules}
        humanHand={game.state.hands[game.seat]}
        humanSeat={game.seat}
        legalPlays={game.legalPlays}
        availableCallCards={game.availableCallCards}
        legalBids={game.legalBids}
        canPass={game.canPass}
        statusText={game.statusText}
        isHumanTurn={game.isHumanTurn}
        pauseAfterTrick={game.pauseAfterTrick}
        awaitingContinue={game.awaitingContinue}
        onBid={game.handleHumanBid}
        onPass={game.handleHumanPass}
        onCallCard={game.handleHumanCallCard}
        onPlayCard={game.handleHumanPlayCard}
        onOpenTutorial={() => game.setShowTutorial(true)}
        onCloseTutorial={() => game.setShowTutorial(false)}
        onNewHand={game.handleNewHand}
        onSetRules={game.handleSetRules}
        onSetPauseAfterTrick={game.handleSetPauseAfterTrick}
        onContinue={game.handleContinue}
        showTutorial={game.showTutorial}
      />
      <div>
        <button onClick={onCreate}>Create Game</button>
      </div>
    </div>
  );
}

/**
 * Entry component. Picks the game variant from the current location on mount:
 * - `#host/<roomKey>` = host (authoritative, persists on F5)
 * - `#join/<roomKey>` = peer
 * - none = solo (with option to create a host room)
 */
function App() {
  // Read the join key once from the URL; it is only relevant on mount.
  const hostKey = useState(() => parseHostKey())[0];
  const joinKey = useState(() => hostKey ? null : parseJoinKey())[0];

  const game = hostKey ? (
    <GameHost key={`host-${hostKey}`} roomKey={hostKey} />
  ) : joinKey ? (
    <GamePeer key={joinKey} roomKey={joinKey} />
  ) : (
    <GameSolo />
  );

  return <GameErrorBoundary>{game}</GameErrorBoundary>;
}

export default App;
