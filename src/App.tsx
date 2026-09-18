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
 * Home screen with "Create Game" and "Join Game" buttons.
 */
function GameHome() {
  const [joinKey, setJoinKey] = useState<string>('');

  const onCreate = useCallback(async () => {
    try {
      const { roomKey } = await makeBroker().createRoom();
      if (!isRoomKeyValid(roomKey)) {
        throw new Error('minted room key failed validation');
      }
      if (typeof window !== 'undefined') {
        window.location.hash = `host/${roomKey}`;
      }
    } catch (err) {
      console.error('Failed to create game', err);
    }
  }, []);

  const onJoin = useCallback(() => {
    if (joinKey.trim() && isRoomKeyValid(joinKey.trim())) {
      if (typeof window !== 'undefined') {
        window.location.hash = `join/${joinKey.trim()}`;
      }
    }
  }, [joinKey]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 text-gray-900 dark:text-gray-200 p-4">
      <div className="text-center max-w-md w-full">
        <h1 className="text-4xl font-bold mb-2 text-gray-800 dark:text-gray-100">
          Floating Bridge
        </h1>
        <p className="text-lg mb-8 text-gray-600 dark:text-gray-400">
          Singaporean Floating Bridge — a bridge game for two or more players
        </p>
        <div className="space-y-4">
          <button
            onClick={onCreate}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-lg transition-colors shadow-lg hover:shadow-xl"
          >
            <span className="flex items-center justify-center gap-2">
              ✦ Create Game
            </span>
          </button>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
            <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
          </div>
          <div>
            <label className="text-sm text-gray-500 dark:text-gray-400 block mb-1">
              Paste invite key
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinKey}
                onChange={(e) => setJoinKey(e.target.value)}
                placeholder="e.g. abc123..."
                onKeyDown={(e) => { if (e.key === 'Enter') onJoin(); }}
                className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={onJoin}
                disabled={!joinKey.trim() || !isRoomKeyValid(joinKey.trim())}
                className="px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Solo fallback — mounted only after a hand ends (ResultPanel "Next hand").
 * The real entry point is GameHome (home screen with create/join buttons).
 */
function GameSolo() {
  const [roomKey, setRoomKey] = useState<string | null>(null);

  const onCreate = useCallback(async () => {
    try {
      const { roomKey: newRoomKey } = await makeBroker().createRoom();
      if (!isRoomKeyValid(newRoomKey)) {
        throw new Error('minted room key failed validation');
      }
      setRoomKey(newRoomKey);
      if (typeof window !== 'undefined') {
        window.location.hash = `host/${newRoomKey}`;
      }
    } catch (err) {
      console.error('Failed to create game', err);
    }
  }, []);

  if (roomKey) {
    return <GameHost key={`host-${roomKey}`} roomKey={roomKey} />;
  }

  // Satisfy noUnusedLocals: the callback is used in GameHome's Create button
  void onCreate;
  return <GameHome />;
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
