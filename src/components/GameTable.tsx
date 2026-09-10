import { useState } from 'react';
import { CardComponent } from './Card';
import type { GameState, Card, Suit, PlayerIndex, Bid } from '../engine/types';
import { PLAYER_NAMES, SUIT_SYMBOLS, SUIT_COLORS, SUITS, RANKS } from '../engine/types';
import { countTricksWon } from '../engine/gameEngine';
import { X, HelpCircle } from 'lucide-react';

interface GameTableProps {
  state: GameState;
  humanHand: Card[];
  legalPlays: Card[];
  availableCallCards: Card[];
  legalBids: Bid[];
  canPass: boolean;
  statusText: string;
  isHumanTurn: boolean;
  onBid: (tricks: number, suit: Suit) => void;
  onPass: () => void;
  onCallCard: (card: Card) => void;
  onPlayCard: (card: Card) => void;
  onOpenTutorial: () => void;
  onCloseTutorial: () => void;
  onNewHand: () => void;
  showTutorial: boolean;
}

const cardKey = (c: Card) => `${c.rank}-${c.suit}`;
const suitClass = (suit: Suit) => (SUIT_COLORS[suit] === 'red' ? 'text-red-600' : 'text-gray-900 dark:text-gray-100');

function CardText({ card }: { card: Card }) {
  return <strong className={suitClass(card.suit)}>{card.rank}{SUIT_SYMBOLS[card.suit]}</strong>;
}

function BidText({ bid }: { bid: Bid }) {
  return <strong className={suitClass(bid.suit)}>{bid.tricks}{SUIT_SYMBOLS[bid.suit]}</strong>;
}

function SuitPicker({ selected, enabled, onSelect }: {
  selected: Suit;
  enabled: (suit: Suit) => boolean;
  onSelect: (suit: Suit) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-3">
      {SUITS.map(suit => (
        <button
          key={suit}
          type="button"
          onClick={() => onSelect(suit)}
          disabled={!enabled(suit)}
          className={`flex flex-col items-center gap-1 py-2 rounded border transition-colors
            disabled:opacity-30 disabled:cursor-not-allowed
            ${selected === suit
              ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
        >
          <span className={`font-bold text-xl ${suitClass(suit)}`}>{SUIT_SYMBOLS[suit]}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{suit}</span>
        </button>
      ))}
    </div>
  );
}

function PlayerArea({ name, hand, isHuman, faceUp, position, playable, onCardClick }: {
  name: string;
  hand: Card[];
  isHuman: boolean;
  faceUp: boolean;
  position: 'north' | 'south' | 'west' | 'east';
  playable?: Set<string>;
  onCardClick?: (card: Card) => void;
}) {
  const isPlayable = (c: Card) => playable?.has(cardKey(c)) ?? false;
  const renderCard = (card: Card, size: 'small' | 'medium') => (
    <CardComponent
      key={cardKey(card)}
      card={card}
      faceUp={faceUp}
      selected={isPlayable(card)}
      // Only legal cards get a click handler: the engine throws on illegal plays.
      onClick={onCardClick && isPlayable(card) ? () => onCardClick(card) : undefined}
      size={size}
    />
  );

  if (position === 'north' || position === 'south') {
    return (
      <div className={`flex flex-col items-center gap-2 ${position === 'south' ? 'mb-4' : 'mt-4'}`}>
        <div className="text-sm font-medium text-gray-600 dark:text-gray-300 text-center">
          {name} {isHuman && '(YOU)'}
        </div>
        <div className="flex gap-1 flex-wrap justify-center max-w-full">
          {hand.map(card => renderCard(card, position === 'south' ? 'medium' : 'small'))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${position === 'west' ? 'mr-4' : 'ml-4'}`}>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-300 text-center">{name}</div>
      <div className="flex flex-col -space-y-10">
        {hand.map(card => renderCard(card, 'small'))}
      </div>
    </div>
  );
}

/** Every bid and pass so far, in table order. Visible for the whole auction. */
function AuctionLog({ state }: { state: GameState }) {
  const { log, activePlayers } = state.auction;
  return (
    <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-3 border border-gray-200 dark:border-gray-700 mb-3 text-sm">
      <div className="flex justify-between items-baseline mb-2">
        <span className="font-semibold text-gray-800 dark:text-gray-100">Auction</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          You don't have a partner yet. The winner will call one after the auction.
        </span>
      </div>
      {log.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400">No bids yet. {PLAYER_NAMES[state.currentPlayer ?? 0]} must open.</div>
      ) : (
        <ol className="flex flex-wrap gap-x-4 gap-y-1">
          {log.map((call, i) => (
            <li key={i} className={activePlayers.has(call.player) ? '' : 'opacity-60'}>
              {PLAYER_NAMES[call.player]}: {call.bid ? <BidText bid={call.bid} /> : <em>pass</em>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BiddingPanel({ state, legalBids, canPass, onBid, onPass }: {
  state: GameState;
  legalBids: Bid[];
  canPass: boolean;
  onBid: (tricks: number, suit: Suit) => void;
  onPass: () => void;
}) {
  const [suit, setSuit] = useState<Suit>('Spades');
  const currentBid = state.auction.currentBid;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
      <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3">
        {currentBid ? 'Your turn: bid higher or pass' : 'Your turn: you must open the bidding'}
      </h3>

      {currentBid && (
        <div className="mb-3 p-2 bg-blue-100 dark:bg-blue-800/30 rounded text-sm">
          Current bid: <BidText bid={currentBid} /> by {PLAYER_NAMES[currentBid.player]}
        </div>
      )}

      <SuitPicker selected={suit} enabled={s => legalBids.some(b => b.suit === s)} onSelect={setSuit} />

      <div className="flex flex-wrap gap-2 justify-center mb-3">
        {Array.from({ length: 13 }, (_, i) => i + 1).map(tricks => (
          <button
            key={tricks}
            onClick={() => onBid(tricks, suit)}
            disabled={!legalBids.some(b => b.tricks === tricks && b.suit === suit)}
            className="px-2 py-1 text-xs font-medium rounded border transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
              hover:bg-blue-100 dark:hover:bg-blue-900/30
              text-gray-800 dark:text-gray-200"
          >
            {tricks} {SUIT_SYMBOLS[suit]}
          </button>
        ))}
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-300 mb-3 text-center">
        A bid is the minimum number of tricks your side must win, with that suit as trump.
      </p>

      <button
        onClick={onPass}
        disabled={!canPass}
        className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
      >
        Pass
      </button>
    </div>
  );
}

function PartnerCallPanel({ contract, availableCallCards, onCallCard }: {
  contract: NonNullable<GameState['contract']>;
  availableCallCards: Card[];
  onCallCard: (card: Card) => void;
}) {
  // Mounted only during the human's PARTNER_CALL, so this default is the real trump suit.
  const [suit, setSuit] = useState<Suit>(contract.trumpSuit);
  const trump = contract.trumpSuit;

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
      <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
        You won the auction. Now choose one card you don't hold.
      </h3>
      <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
        Whoever holds that card becomes your partner. Contract:{' '}
        <BidText bid={{ player: 0, tricks: contract.tricksRequired, suit: trump }} /> ({trump} are trump).
      </p>

      <SuitPicker selected={suit} enabled={s => availableCallCards.some(c => c.suit === s)} onSelect={setSuit} />

      <div className="flex flex-wrap gap-2 justify-center">
        {RANKS.map(rank => (
          <button
            key={rank}
            onClick={() => onCallCard({ suit, rank })}
            disabled={!availableCallCards.some(c => c.rank === rank && c.suit === suit)}
            className="px-2 py-1 text-xs font-medium rounded border transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
              hover:bg-yellow-100 dark:hover:bg-yellow-900/30
              text-gray-800 dark:text-gray-200"
          >
            {rank} {SUIT_SYMBOLS[suit]}
          </button>
        ))}
      </div>

      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3 text-center">
        Cards in your own hand are greyed out. A common choice is the highest trump you don't hold.
      </p>
    </div>
  );
}

function TrickArea({ state }: { state: GameState }) {
  if (state.phase !== 'TRICK_PLAY' && state.phase !== 'HAND_RESULT') return null;

  const current = state.tricks.current;
  const lastCompleted = state.tricks.completed[state.tricks.completed.length - 1];
  // Keep the finished trick on the table until the next lead so the last card is visible.
  const shown = current && current.cards.length > 0 ? current : lastCompleted ?? current;
  const slot = (p: PlayerIndex) => {
    const played = shown?.cards.find(c => c.player === p);
    return (
      <div className="w-16 h-22 flex items-center justify-center">
        {played && (
          <CardComponent
            card={played.card}
            faceUp={true}
            size="medium"
            className={shown?.winner === p && shown.cards.length === 4 ? 'ring-2 ring-green-500' : ''}
          />
        )}
      </div>
    );
  };

  const p = state.partnerships;
  const declarerSide = p ? countTricksWon(state.tricks.completed, p) : 0;
  const defenderSide = state.tricks.completed.length - declarerSide;

  return (
    <div className="relative flex-1 flex items-center justify-center p-4 min-h-64">
      <div className="flex flex-col items-center gap-2">
        {slot(2)}
        <div className="flex gap-8">
          {slot(1)}
          {slot(3)}
        </div>
        {slot(0)}
      </div>

      <div className="absolute bottom-2 left-2 text-sm text-gray-600 dark:text-gray-300">
        Trick {Math.min(state.tricks.completed.length + 1, 13)} / 13
      </div>

      {p && state.contract && (
        <div className="absolute bottom-2 right-2 text-xs text-gray-600 dark:text-gray-300 text-right">
          <div>
            {PLAYER_NAMES[p.declarer]} + {PLAYER_NAMES[p.partner]}:{' '}
            <strong>{declarerSide}</strong> / {state.contract.tricksRequired} needed
          </div>
          <div>
            {PLAYER_NAMES[p.defenders[0]]} + {PLAYER_NAMES[p.defenders[1]]}: <strong>{defenderSide}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

/** Contract, called card and the human's side. Spells out the relationships, never leaves them to inference. */
function ContractBadge({ state }: { state: GameState }) {
  if (!state.contract || state.auction.declarer === null) return null;
  const { trumpSuit, tricksRequired } = state.contract;
  const declarer = state.auction.declarer;
  const p = state.partnerships;

  let side: string | null = null;
  if (p) {
    if (p.declarer === 0) side = `Your partner is ${PLAYER_NAMES[p.partner]}.`;
    else if (p.partner === 0) side = `You are ${PLAYER_NAMES[p.declarer]}'s partner.`;
    else side = `You defend with ${PLAYER_NAMES[p.defenders.find(d => d !== 0)!]}.`;
  }

  const pill = 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 px-3 py-1 rounded-full';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={pill}>
        <BidText bid={{ player: declarer, tricks: tricksRequired, suit: trumpSuit }} /> by {PLAYER_NAMES[declarer]}
        {' '}({trumpSuit} trump, {tricksRequired} tricks needed)
      </span>
      {state.calledCard && p && (
        <span className={pill}>
          Called <CardText card={state.calledCard} />, held by <strong>{PLAYER_NAMES[p.partner]}</strong>
        </span>
      )}
      {side && <span className={`${pill} font-medium`}>{side}</span>}
    </div>
  );
}

function ResultPanel({ state, onNewHand }: { state: GameState; onNewHand: () => void }) {
  if (state.phase !== 'HAND_RESULT' || !state.result || !state.contract || !state.partnerships) return null;

  const made = state.result.contractMade;
  const { declarer, partner } = state.partnerships;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className={`bg-white dark:bg-gray-800 rounded-xl p-8 max-w-md w-full mx-4 text-center border-4 ${made ? 'border-green-500' : 'border-red-500'}`}>
        <h2 className={`text-3xl font-bold mb-4 ${made ? 'text-green-600' : 'text-red-600'}`}>
          {made ? 'CONTRACT MADE' : 'CONTRACT FAILED'}
        </h2>

        <div className="space-y-2 mb-6 text-lg">
          <p>Contract: <BidText bid={{ player: declarer, tricks: state.contract.tricksRequired, suit: state.contract.trumpSuit }} /></p>
          <p>Declarer: <strong>{PLAYER_NAMES[declarer]}</strong></p>
          <p>Partner: <strong>{PLAYER_NAMES[partner]}</strong>{state.calledCard && <> (held <CardText card={state.calledCard} />)</>}</p>
          <p>Tricks won: <strong>{state.result.tricksWonByDeclarer} / {state.contract.tricksRequired}</strong></p>
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
    'Deal: everyone receives 13 private cards.',
    "Bid: players compete to name how many tricks their eventual partnership will win, and in which trump suit. Higher number wins; on a tie, Spades > Hearts > Clubs > Diamonds. You don't know who your partner is yet!",
    'The winning bid sets the trump suit. The first bidder may not pass; the auction ends when only one bidder is left.',
    "Call a card: the declarer names a card they don't hold. Whoever has it becomes their partner. This game reveals the partner at once.",
    "Play: the player to declarer's left leads. Follow suit if you can. Trumps beat everything else; otherwise the highest card of the led suit wins, and the winner leads next.",
    'Check the contract: if the declarer and partner win at least the bid number of tricks, they succeed.',
  ];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">How to Play Singaporean Floating Bridge</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <ol className="space-y-3 text-left">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-sm">
          <div className="font-semibold mb-2">Worked example</div>
          <p>South bids 5♥. West bids 5♠. North bids 6♣. East passes. South bids 6♥. West passes. North passes.</p>
          <p className="mt-1">South wins the auction with 6♥. South does not hold K♥, so South calls K♥. North holds K♥, so North becomes South's partner. West and East defend.</p>
          <p className="mt-1">West leads the first trick. Hearts are trump. South + North must win at least 6 tricks.</p>
          <p className="mt-2 font-medium">Note: North was NOT South's partner during the auction. Partnerships only exist once a card is called.</p>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          This implements one common Singaporean ruleset. Local variants exist. It is not Contract Bridge: no fixed partners, no dummy, no no-trump, no doubling.
        </p>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
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
  canPass,
  statusText,
  isHumanTurn,
  onBid,
  onPass,
  onCallCard,
  onPlayCard,
  onOpenTutorial,
  onCloseTutorial,
  onNewHand,
  showTutorial,
}: GameTableProps) {
  const legalPlayKeys = new Set(legalPlays.map(cardKey));
  const humanCalling = state.phase === 'PARTNER_CALL' && isHumanTurn && state.contract;
  const hiddenHand = (p: PlayerIndex, position: 'north' | 'west' | 'east') => (
    <PlayerArea name={PLAYER_NAMES[p]} hand={state.hands[p]} isHuman={false} faceUp={false} position={position} />
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Singaporean Floating Bridge</h1>
          <button onClick={onOpenTutorial} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
            <HelpCircle className="w-4 h-4" /> How to play
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-300">{statusText}</span>
          <ContractBadge state={state} />
        </div>
      </header>

      <div className="flex flex-col items-center justify-center flex-1">
        {hiddenHand(2, 'north')}

        <div className="flex flex-1 items-center justify-center w-full max-w-4xl relative">
          <div className="w-full flex flex-row items-center justify-between">
            {hiddenHand(1, 'west')}
            <TrickArea state={state} />
            {hiddenHand(3, 'east')}
          </div>
        </div>

        <PlayerArea
          name={PLAYER_NAMES[0]}
          hand={humanHand}
          isHuman={true}
          faceUp={true}
          position="south"
          playable={legalPlayKeys}
          onCardClick={onPlayCard}
        />

        <div className="w-full max-w-2xl mt-4">
          {state.phase === 'AUCTION' && <AuctionLog state={state} />}
          {state.phase === 'AUCTION' && isHumanTurn && (
            <BiddingPanel state={state} legalBids={legalBids} canPass={canPass} onBid={onBid} onPass={onPass} />
          )}
          {humanCalling && (
            <PartnerCallPanel contract={state.contract!} availableCallCards={availableCallCards} onCallCard={onCallCard} />
          )}
        </div>
      </div>

      <ResultPanel state={state} onNewHand={onNewHand} />

      {showTutorial && <TutorialOverlay onClose={onCloseTutorial} />}
    </div>
  );
}
