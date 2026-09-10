import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import './index.css';

function App() {
  const {
    state,
    showTutorial,
    setShowTutorial,
    handleNewHand,
    handleHumanBid,
    handleHumanPass,
    handleHumanCallCard,
    handleHumanPlayCard,
    legalBids,
    legalPlays,
    availableCallCards,
    canPass,
    statusText,
    isHumanTurn,
  } = useGame();

  return (
    <GameTable
      state={state}
      humanHand={state.hands[0]}
      legalPlays={legalPlays}
      availableCallCards={availableCallCards}
      legalBids={legalBids}
      canPass={canPass}
      statusText={statusText}
      isHumanTurn={isHumanTurn}
      onBid={handleHumanBid}
      onPass={handleHumanPass}
      onCallCard={handleHumanCallCard}
      onPlayCard={handleHumanPlayCard}
      onOpenTutorial={() => setShowTutorial(true)}
      onCloseTutorial={() => setShowTutorial(false)}
      onNewHand={handleNewHand}
      showTutorial={showTutorial}
    />
  );
}

export default App;
