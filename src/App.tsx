import { useState, useMemo, useCallback } from 'react';
import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import { makeTransportBroker } from './network/roomBroker';
import type { TransportBroker } from './network/transport';
import './index.css';

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

/**
 * The game host. Renders the table driven by the transport in host mode and
 * shows a "Create Game" button that mints a new room, appends its invite key
 * to the location, and remounts this component as the new host.
 */
function GameHost({
  roomKey,
  broker,
}: {
  roomKey: string | null;
  broker: TransportBroker;
}) {
  const game = useGame({ roomKey, isHost: true, broker });

  return (
    <GameTable
      state={game.state}
      rules={game.rules}
      humanHand={game.state.hands[0]}
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
  broker,
}: {
  roomKey: string;
  broker: TransportBroker;
}) {
  const game = useGame({ roomKey, isHost: false, broker });

  return (
    <GameTable
      state={game.state}
      rules={game.rules}
      humanHand={game.state.hands[0]}
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
function GameSolo({ broker }: { broker: TransportBroker }) {
  const game = useGame();
  const [roomKey, setRoomKey] = useState<string | null>(null);

  const onCreate = useCallback(async () => {
    try {
      const { roomKey: key } = await broker.createRoom();
      setRoomKey(key);
      if (typeof window !== 'undefined') {
        window.location.hash = `join/${key}`;
      }
    } catch (err) {
      console.error('Failed to create game', err);
    }
  }, [broker]);

  // Remount on the new key swaps the hook variant cleanly (solo -> host) with a
  // fresh hook context, so React's hook-order invariant holds.
  if (roomKey) {
    return <GameHost key={`host-${roomKey}`} roomKey={roomKey} broker={broker} />;
  }

  return (
    <div key="solo">
      <GameTable
        state={game.state}
        rules={game.rules}
        humanHand={game.state.hands[0]}
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
 * a `#join/<roomKey>` hash means join as peer, otherwise start solo (with the
 * option to create a host room).
 */
function App() {
  // Read the join key once from the URL; it is only relevant on mount.
  const joinKey = useState(() => parseJoinKey())[0];
  const broker = useMemo<TransportBroker>(() => makeTransportBroker(), []);

  if (joinKey) {
    return <GamePeer key={joinKey} roomKey={joinKey} broker={broker} />;
  }
  return <GameSolo broker={broker} />;
}

export default App;
