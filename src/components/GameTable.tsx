import { CardComponent } from './Card';
import type { GameState, Card, Suit, Rank } from '../engine/types';
import { PLAYER_NAMES, SUIT_SYMBOLS } from '../engine/types';
import { X } from 'lucide-react';

interface GameTableProps {
  state: GameState;
  humanHand: Card[];
  legalPlays: Card[];
  availableCallCards: Card[];
  legalBids: Array<{ tricks: number; suit: Suit }>;
  statusText: string;
  isHumanTurn: boolean;
  onBid: (tricks: number, suit: Suit) => void;
  onPass: () => void;
  onCallCard: (card: Card) => void;
  onPlayCard: (card: Card) => void;
  onCloseTutorial: () => void;
  showTutorial: boolean;
}

function PlayerArea({ name, hand, isHuman, faceUp, position, selectedCards, onCardClick }: {
  name: string;
  hand: Card[];
  isHuman: boolean;
  faceUp: boolean;
  position: 'north' | 'south' | 'west' | 'east';
  selectedCards?: Set<string>;
  onCardClick?: (card: Card) => void;
}) {
  const cardKey = (c: Card) => `${c.rank}-${c.suit}`;
  const isSelected = selectedCards ? (c: Card) => selectedCards.has(cardKey(c)) : () => false;

  if (position === 'north' || position === 'south') {
    return (
      <div className={`flex flex-col items-center gap-2 ${position === 'south' ? 'mb-4' : 'mt-4'}`}>
        <div className="text-sm font-medium text-gray-600 dark:text-gray-300 w-24 text-center">
          {name} {isHuman && '(YOU)'}
        </div>
        <div className="flex gap-1 flex-wrap justify-center" style={{ maxWidth: '100%' }}>
          {hand.map(card => (
            <CardComponent
              key={cardKey(card)}
              card={card}
              faceUp={faceUp}
              selected={isSelected(card)}
              onClick={onCardClick ? () => onCardClick(card) : undefined}
              size={position === 'south' ? 'medium' : 'small'}
            />
          ))}
        </div>
      </div>
    );
  }

  // West/East - vertical layout
  return (
    <div className={`flex flex-col items-center gap-2 ${position === 'west' ? 'mr-4' : 'ml-4'}`}>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-300 writing-mode-vertical-rl text-center h-24">
        {name.split('').join(' ')}
      </div>
      <div className="flex flex-col gap-1">
        {hand.map(card => (
          <CardComponent
            key={cardKey(card)}
            card={card}
            faceUp={faceUp}
            selected={isSelected(card)}
            onClick={onCardClick ? () => onCardClick(card) : undefined}
            size="small"
          />
        ))}
      </div>
    </div>
  );
}

function BiddingPanel({ state, legalBids, onBid, onPass, isHumanTurn }: {
  state: GameState;
  legalBids: Array<{ tricks: number; suit: Suit }>;
  onBid: (tricks: number, suit: Suit) => void;
  onPass: () => void;
  isHumanTurn: boolean;
}) {
  if (!isHumanTurn || state.phase !== 'AUCTION') return null;

  const suits: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  const currentBid = state.auction.currentBid;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
      <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3">Your Turn to Bid</h3>

      {currentBid && (
        <div className="mb-3 p-2 bg-blue-100 dark:bg-blue-800/30 rounded text-sm">
          Current bid: <strong>{currentBid.tricks} {SUIT_SYMBOLS[currentBid.suit]}</strong> by {PLAYER_NAMES[currentBid.player]}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-3">
        {suits.map(suit => (
          <div key={suit} className="flex flex-col items-center gap-1">
            <span className="font-bold text-xl">{SUIT_SYMBOLS[suit]}</span>
            <span className="text-xs text-gray-500">{suit}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center mb-3">
        {[1,2,3,4,5,6,7,8,9,10,11,12,13].map(tricks => (
          <button
            key={tricks}
            onClick={() => {
              const bid = legalBids.find(b => b.tricks === tricks);
              if (bid) onBid(tricks, bid.suit);
            }}
            disabled={!legalBids.some(b => b.tricks === tricks)}
            className="px-2 py-1 text-xs font-medium rounded border transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
              hover:bg-blue-100 dark:hover:bg-blue-900/30
              text-gray-800 dark:text-gray-200"
          >
            {tricks}
          </button>
        ))}
      </div>

      <button
        onClick={onPass}
        disabled={state.auction.bids.length === 0 && state.currentPlayer === 0}
        className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
      >
        Pass
      </button>
    </div>
  );
}

function PartnerCallPanel({ state, availableCallCards, onCallCard }: {
  state: GameState;
  availableCallCards: Card[];
  onCallCard: (card: Card) => void;
}) {
  if (state.phase !== 'PARTNER_CALL' || state.currentPlayer !== 0) return null;

  const suits: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
      <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-3">
        {PLAYER_NAMES[state.auction.declarer!]} won the auction. Choose a card to call your partner.
      </h3>
      <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
        Contract: {state.contract?.tricksRequired} {SUIT_SYMBOLS[state.contract?.trumpSuit!]}
        | Trump: {SUIT_SYMBOLS[state.contract?.trumpSuit!]}
      </p>

      <div className="grid grid-cols-4 gap-2 mb-4">
        {suits.map(suit => (
          <div key={suit} className="flex flex-col items-center gap-1">
            <span className="font-bold text-xl">{SUIT_SYMBOLS[suit]}</span>
            <span className="text-xs text-gray-500">{suit}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {ranks.map(rank => (
          <button
            key={rank}
            onClick={() => {
              for (const suit of suits) {
                const card = availableCallCards.find(c => c.rank === rank && c.suit === suit);
                if (card) { onCallCard(card); break; }
              }
            }}
            disabled={!availableCallCards.some(c => c.rank === rank)}
            className="px-2 py-1 text-xs font-medium rounded border transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
              hover:bg-yellow-100 dark:hover:bg-yellow-900/30
              text-gray-800 dark:text-gray-200"
          >
            {rank}
          </button>
        ))}
      </div>

      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3 text-center">
        Click a rank to call the highest available card of that rank. You cannot call cards in your hand.
      </p>
    </div>
  );
}

function TrickArea({ state }: { state: GameState }) {
  if (state.phase !== 'TRICK_PLAY' || !state.tricks.current) return null;

  const currentTrick = state.tricks.current;
  const trumpSuit = state.contract?.trumpSuit;

  return (
    <div className="relative flex-1 flex items-center justify-center p-4">
      {trumpSuit && (
        <div className="absolute top-2 right-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-3 py-1 rounded-full text-sm font-medium">
          Trump: {SUIT_SYMBOLS[trumpSuit]}
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        {currentTrick.cards.some(c => c.player === 2) && (
          <CardComponent
            card={currentTrick.cards.find(c => c.player === 2)!.card}
            faceUp={true}
            size="medium"
          />
        )}

        <div className="flex gap-8">
          {currentTrick.cards.some(c => c.player === 1) && (
            <CardComponent
              card={currentTrick.cards.find(c => c.player === 1)!.card}
              faceUp={true}
              size="medium"
            />
          )}

          {currentTrick.cards.some(c => c.player === 3) && (
            <CardComponent
              card={currentTrick.cards.find(c => c.player === 3)!.card}
              faceUp={true}
              size="medium"
            />
          )}
        </div>

        {currentTrick.cards.some(c => c.player === 0) && (
          <CardComponent
            card={currentTrick.cards.find(c => c.player === 0)!.card}
            faceUp={true}
            size="medium"
          />
        )}
      </div>

      <div className="absolute bottom-2 left-2 text-sm text-gray-600 dark:text-gray-300">
        Trick {state.tricks.completed.length + 1} / 13
      </div>

      <div className="absolute bottom-2 right-2 text-sm text-gray-600 dark:text-gray-300">
        {state.partnerships && (
          <>
            <span className="font-medium">NS: {state.tricks.completed.filter(t =>
              t.winner === 0 || t.winner === 2
            ).length}</span> |{' '}
            <span className="font-medium">EW: {state.tricks.completed.filter(t =>
              t.winner === 1 || t.winner === 3
            ).length}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ state, onNewHand }: { state: GameState; onNewHand: () => void }) {
  if (state.phase !== 'HAND_RESULT' || !state.result) return null;

  const made = state.result.contractMade;
  const declarerPartnership = state.partnerships!;
  const declarerName = PLAYER_NAMES[declarerPartnership.declarer];
  const partnerName = PLAYER_NAMES[declarerPartnership.partner];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className={`bg-white dark:bg-gray-800 rounded-xl p-8 max-w-md w-full mx-4 text-center ${made ? 'border-4 border-green-500' : 'border-4 border-red-500'}`}>
        <h2 className={`text-3xl font-bold mb-4 ${made ? 'text-green-600' : 'text-red-600'}`}>
          {made ? 'CONTRACT MADE' : 'CONTRACT FAILED'}
        </h2>

        <div className="space-y-2 mb-6 text-lg">
          <p>Contract: <strong>{state.contract?.tricksRequired} {SUIT_SYMBOLS[state.contract?.trumpSuit!]}</strong></p>
          <p>Declarer: <strong>{declarerName}</strong></p>
          <p>Partner: <strong>{partnerName}</strong></p>
          <p>Tricks won: <strong>{state.result.tricksWonByDeclarer} / {state.contract?.tricksRequired}</strong></p>
        </div>

        <button
          onClick={onNewHand}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Play Next Hand
        </button>
      </div>
    </div>
  );
}

function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const steps = [
    "Welcome to Singaporean Floating Bridge!",
    "Step 1 - Deal: Everyone receives 13 private cards.",
    "Step 2 - Bid: Players bid the number of tricks their partnership can win. You don't know who your partner is yet!",
    "Step 3 - The winning bid sets the trump suit.",
    "Step 4 - The declarer calls a card they don't hold. Whoever has it becomes their partner.",
    "Step 5 - Play: The player to declarer's left leads. Follow suit if you can. Trump beats everything.",
    "Step 6 - If declarer's partnership makes the contracted tricks, they win!",
  ];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">How to Play</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        <ol className="space-y-4 text-left">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>

        <button
          onClick={onClose}
          className="mt-6 w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Got it!
        </button>
      </div>
    </div>
  );
}

export function GameTable({
  state,
  humanHand,
  legalPlays,
  availableCallCards,
  legalBids,
  statusText,
  isHumanTurn,
  onBid,
  onPass,
  onCallCard,
  onPlayCard,
  onCloseTutorial,
  showTutorial,
}: GameTableProps) {
  const legalPlayKeys = new Set(legalPlays.map(c => `${c.rank}-${c.suit}`));

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Singaporean Floating Bridge</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 dark:text-gray-300">{statusText}</span>
          {showTutorial && (
            <button onClick={onCloseTutorial} className="text-sm text-blue-600 hover:underline">
              Hide Tutorial
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-col items-center justify-center flex-1">
        <PlayerArea
          name={PLAYER_NAMES[2]}
          hand={state.hands[2]}
          isHuman={false}
          faceUp={false}
          position="north"
        />

        <div className="flex flex-1 items-center justify-center w-full max-w-4xl relative">
          <div className="w-4/5 flex flex-col items-center justify-center">
            <PlayerArea
              name={PLAYER_NAMES[1]}
              hand={state.hands[1]}
              isHuman={false}
              faceUp={false}
              position="west"
            />

            <TrickArea state={state} />

            <PlayerArea
              name={PLAYER_NAMES[3]}
              hand={state.hands[3]}
              isHuman={false}
              faceUp={false}
              position="east"
            />
          </div>
        </div>

        <PlayerArea
          name={PLAYER_NAMES[0]}
          hand={humanHand}
          isHuman={true}
          faceUp={true}
          position="south"
          selectedCards={legalPlayKeys}
          onCardClick={onPlayCard}
        />

        <div className="w-full max-w-2xl mt-4">
          <BiddingPanel state={state} legalBids={legalBids} onBid={onBid} onPass={onPass} isHumanTurn={isHumanTurn} />
          <PartnerCallPanel state={state} availableCallCards={availableCallCards} onCallCard={onCallCard} />
        </div>
      </div>

      <ResultPanel state={state} onNewHand={() => {}} />

      {showTutorial && <TutorialOverlay onClose={onCloseTutorial} />}
    </div>
  );
}