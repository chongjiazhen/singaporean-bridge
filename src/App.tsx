import { GameTable } from './components/GameTable';
import { useGame } from './hooks/useGame';
import './index.css';

function App() {
  const {
    state,
    rules,
    showTutorial,
    setShowTutorial,
    pauseAfterTrick,
    awaitingContinue,
    handleNewHand,
    handleSetRules,
    handleSetPauseAfterTrick,
    handleContinue,
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
      rules={rules}
      humanHand={state.hands[0]}
      legalPlays={legalPlays}
      availableCallCards={availableCallCards}
      legalBids={legalBids}
      canPass={canPass}
      statusText={statusText}
      isHumanTurn={isHumanTurn}
      pauseAfterTrick={pauseAfterTrick}
      awaitingContinue={awaitingContinue}
      onBid={handleHumanBid}
      onPass={handleHumanPass}
      onCallCard={handleHumanCallCard}
      onPlayCard={handleHumanPlayCard}
      onOpenTutorial={() => setShowTutorial(true)}
      onCloseTutorial={() => setShowTutorial(false)}
      onNewHand={handleNewHand}
      onSetRules={handleSetRules}
      onSetPauseAfterTrick={handleSetPauseAfterTrick}
      onContinue={handleContinue}
      showTutorial={showTutorial}
    />
  );
}

export default App;
