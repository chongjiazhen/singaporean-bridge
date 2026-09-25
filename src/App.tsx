import { useState, useCallback, useMemo, useEffect, Component, type ReactNode } from 'react';
import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import { makeTransportBroker } from './network/roomBroker';
import { makeBroker, isRoomKeyValid } from './network/signaling';
import { setHostSeed, mintSeed, readSeed } from './network/dealSeed';
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
  const game = useGame({ roomKey, isHost: true, broker, waitForPeers: true, seed: readSeed(roomKey) });

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
      canStartGame={game.canStartGame}
      onStartGame={game.handleStartGame}
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
 * The single-player solo table. This is the default screen: it runs the local
 * engine and offers one path to multiplayer — hosting a game from the table's
 * header via `onHost` (rendered by GameTable).
 */
function SoloGame() {
  const game = useGame({});

  // Solo hosts a peer room directly from the table. The button lives in the
  // table header and calls this; it navigates the tab to `#host/<key>`.
  const onHost = useCallback(async () => {
    try {
      const { roomKey } = await makeBroker().createRoom();
      if (!isRoomKeyValid(roomKey)) {
        throw new Error('minted room key failed validation');
      }
      // Seed the deal so every fresh hand is reproducible from this seed. Stored
      // in sessionStorage (same-tab) so the host room below can read it back;
      // peers never need it because they render the authoritative snapshot.
      setHostSeed(roomKey, mintSeed());
      if (typeof window !== 'undefined') {
        window.location.hash = `host/${roomKey}`;
      }
    } catch (err) {
      console.error('Failed to create game', err);
    }
  }, []);

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
      onHost={onHost}
    />
  );
}

/**
 * Entry component. Picks the game variant from the current location:
 * - `#host/<roomKey>` = host (authoritative, persists on F5)
 * - `#join/<roomKey>` = peer
 * - none = solo (the default screen; host a game from the table header)
 *
 * Listens for hashchange so navigating via location.hash works without refresh.
 */
function App() {
  const [hostKey, setHostKey] = useState(() => parseHostKey());
  const [joinKey, setJoinKey] = useState(() => hostKey ? null : parseJoinKey());

  // Keep hash state in sync with URL. Navigating via location.hash (e.g. from
  // onHost) would otherwise require a manual refresh because React only reads
  // the initial hash from the useState initializer.
  useEffect(() => {
    const onHashChange = () => {
      const hk = parseHostKey();
      const jk = hk ? null : parseJoinKey();
      setHostKey(hk);
      setJoinKey(jk);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const game = hostKey ? (
    <GameHost key={`host-${hostKey}`} roomKey={hostKey} />
  ) : joinKey ? (
    <GamePeer key={joinKey} roomKey={joinKey} />
  ) : (
    <SoloGame />
  );

  return <GameErrorBoundary>{game}</GameErrorBoundary>;
}

export default App;
