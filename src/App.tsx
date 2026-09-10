import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import './index.css';

function App() {
  const {
    state,
    showTutorial,
    setShowTutorial,
    handleHumanBid,
    handleHumanPass,
    handleHumanCallCard,
    handleHumanPlayCard,
    legalBids,
    legalPlays,
    availableCallCards,
    statusText,
    isHumanTurn,
  } = useGame();

  const humanHand = state.hands[0];

  return (
    <GameTable
      state={state}
      humanHand={humanHand}
      legalPlays={legalPlays}
      availableCallCards={availableCallCards}
      legalBids={legalBids}
      statusText={statusText}
      isHumanTurn={isHumanTurn}
      onBid={handleHumanBid}
      onPass={handleHumanPass}
      onCallCard={handleHumanCallCard}
      onPlayCard={handleHumanPlayCard}
      onCloseTutorial={() => setShowTutorial(false)}
      showTutorial={showTutorial}
    />
  );
}

export default App;