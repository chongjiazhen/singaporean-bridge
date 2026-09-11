import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CardComponent } from './Card';
import type { GameState, Card, Suit, Strain, PlayerIndex, Bid, GameRules, Trick, Contract } from '../engine/types';
import {
  PLAYER_NAMES, SUIT_SYMBOLS, SUIT_COLORS, STRAIN_SYMBOLS, STRAINS, SUITS, RANKS, PLAYERS,
  MIN_LEVEL, MAX_LEVEL, tricksForLevel, cardsEqual, handPoints, isSolo, MIN_WASH_POINTS, MAX_WASH_POINTS,
} from '../engine/types';
import { countTricksWon, getSideKnowledge, isPartnershipPublic } from '../engine/gameEngine';
import { trickVerdictText } from '../engine/trickEvaluator';
import { X, HelpCircle } from 'lucide-react';

interface GameTableProps {
  state: GameState;
  /** Rules the player has chosen; may differ from state.rules until the next deal. */
  rules: GameRules;
  humanHand: Card[];
  legalPlays: Card[];
  availableCallCards: Card[];
  legalBids: Bid[];
  canPass: boolean;
  statusText: string;
  isHumanTurn: boolean;
  onBid: (level: number, strain: Strain) => void;
  onPass: () => void;
  onCallCard: (card: Card) => void;
  onPlayCard: (card: Card) => void;
  onOpenTutorial: () => void;
  onCloseTutorial: () => void;
  onNewHand: () => void;
  onSetRules: (rules: Partial<GameRules>) => void;
  showTutorial: boolean;
  /** Hold a finished trick on the table until the player presses Next. */
  pauseAfterTrick: boolean;
  /** A finished trick is being held: no legal plays, AI paused. */
  awaitingContinue: boolean;
  onSetPauseAfterTrick: (pause: boolean) => void;
  onContinue: () => void;
}

const cardKey = (c: Card) => `${c.rank}-${c.suit}`;
const strainClass = (strain: Strain) => {
  if (strain === 'NoTrump') return 'text-blue-700 dark:text-blue-300';
  return SUIT_COLORS[strain] === 'red' ? 'text-red-600' : 'text-gray-900 dark:text-gray-100';
};

function CardText({ card }: { card: Card }) {
  return <strong className={strainClass(card.suit)}>{card.rank}{SUIT_SYMBOLS[card.suit]}</strong>;
}

function BidText({ bid }: { bid: { level: number; strain: Strain } }) {
  return <strong className={strainClass(bid.strain)}>{bid.level}{STRAIN_SYMBOLS[bid.strain]}</strong>;
}

/** "Hearts trump, 8 tricks" or "no trump, 7 tricks, declarer leads". */
function contractTerms(contract: Contract): string {
  const trump = contract.trumpSuit ? `${contract.trumpSuit} trump` : 'no trump';
  const lead = contract.trumpSuit ? '' : ', declarer leads';
  return `${trump}, ${contract.tricksRequired} tricks needed${lead}`;
}

function StrainPicker<T extends Strain>({ options, selected, enabled, onSelect }: {
  options: readonly T[];
  selected: T;
  enabled: (strain: T) => boolean;
  onSelect: (strain: T) => void;
}) {
  return (
    <div className={`grid ${options.length === 5 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mb-3`}>
      {options.map(strain => (
        <button
          key={strain}
          type="button"
          onClick={() => onSelect(strain)}
          disabled={!enabled(strain)}
          className={`flex flex-col items-center gap-1 py-2 rounded border transition-colors
            disabled:opacity-30 disabled:cursor-not-allowed
            ${selected === strain
              ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
        >
          <span className={`font-bold text-xl ${strainClass(strain)}`}>{STRAIN_SYMBOLS[strain]}</span>
          <span className="text-xs text-gray-600 dark:text-gray-300">{strain === 'NoTrump' ? 'No trump' : strain}</span>
        </button>
      ))}
    </div>
  );
}

function PlayerArea({
  name, hand, isHuman, faceUp, position, playable, onCardClick,
  dimIllegal = false, onIllegalClick, shakenKey = null, trumpSuit = null, hint,
}: {
  name: string;
  hand: Card[];
  isHuman: boolean;
  faceUp: boolean;
  position: 'north' | 'south' | 'west' | 'east';
  playable?: Set<string>;
  onCardClick?: (card: Card) => void;
  /** Grey out the cards that are not legal right now, and make them tap-to-explain. */
  dimIllegal?: boolean;
  onIllegalClick?: (card: Card) => void;
  /** Key of the card currently playing the "you can't play that" shake. */
  shakenKey?: string | null;
  /** Marks trumps in this hand; null in a no-trump contract. */
  trumpSuit?: Suit | null;
  /** Rendered just above the hand - the follow-suit coaching line. */
  hint?: ReactNode;
}) {
  const isPlayable = (c: Card) => playable?.has(cardKey(c)) ?? false;
  const renderCard = (card: Card, size: 'small' | 'medium') => {
    const key = cardKey(card);
    const legal = isPlayable(card);
    const dimmed = dimIllegal && !legal;
    return (
      <CardComponent
        key={key}
        card={card}
        faceUp={faceUp}
        selected={legal}
        dimmed={dimmed}
        trump={faceUp && trumpSuit !== null && card.suit === trumpSuit}
        shake={shakenKey === key}
        // Only legal cards reach the engine: it throws on illegal plays. An illegal card
        // instead flashes the hint that explains why it cannot be played.
        onClick={
          onCardClick && legal
            ? () => onCardClick(card)
            : dimmed && onIllegalClick
              ? () => onIllegalClick(card)
              : undefined
        }
        size={size}
      />
    );
  };

  if (position === 'north' || position === 'south') {
    return (
      <div className={`flex flex-col items-center gap-2 ${position === 'south' ? 'mb-4' : 'mt-4'}`}>
        <div className="text-sm font-medium text-gray-600 dark:text-gray-300 text-center">
          {name} {isHuman && '(YOU)'}
        </div>
        {hint}
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
        <span className="text-xs text-gray-600 dark:text-gray-300">
          You don't have a partner yet. The winner will call one after the auction.
        </span>
      </div>
      {state.rules.wash && (
        <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">
          {state.washes > 0 && `Washed ${state.washes} ${state.washes === 1 ? 'deal' : 'deals'}. `}
          Every hand has at least {state.rules.washMinPoints} points; yours has {handPoints(state.hands[0])}.
        </div>
      )}
      {log.length === 0 ? (
        <div className="text-gray-600 dark:text-gray-300">No bids yet. {PLAYER_NAMES[state.currentPlayer ?? 0]} must open.</div>
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
  onBid: (level: number, strain: Strain) => void;
  onPass: () => void;
}) {
  const [strain, setStrain] = useState<Strain>('Spades');
  const currentBid = state.auction.currentBid;
  const levels = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => i + MIN_LEVEL);

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
      <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3">
        {currentBid ? 'Your turn: bid higher or pass' : 'Your turn: you must open the bidding'}
      </h3>

      {currentBid && (
        <div className="mb-3 p-2 bg-blue-100 dark:bg-blue-800/30 rounded text-sm">
          Current bid: <BidText bid={currentBid} /> by {PLAYER_NAMES[currentBid.player]}
          {' '}({tricksForLevel(currentBid.level)} tricks)
        </div>
      )}

      <StrainPicker options={STRAINS} selected={strain} enabled={s => legalBids.some(b => b.strain === s)} onSelect={setStrain} />

      <div className="grid grid-cols-7 gap-2 mb-3">
        {levels.map(level => (
          <button
            key={level}
            onClick={() => onBid(level, strain)}
            disabled={!legalBids.some(b => b.level === level && b.strain === strain)}
            className="flex flex-col items-center px-1 py-1 text-xs font-medium rounded border transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600
              hover:bg-blue-100 dark:hover:bg-blue-900/30
              text-gray-800 dark:text-gray-200"
          >
            <span className="text-sm">{level}{STRAIN_SYMBOLS[strain]}</span>
            <span className="text-[10px] text-gray-600 dark:text-gray-300">{tricksForLevel(level)} tricks</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-300 mb-3 text-center">
        Level + 6 is the tricks your side must win: 1♠ needs 7, 7NT needs all 13.
        At the same level NT &gt; ♠ &gt; ♥ &gt; ♣ &gt; ♦.
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

/** Warning toast shown before the declarer calls a card they hold and so plays alone. */
export function SoloCallWarning({ card, hiddenPartner, onConfirm, onCancel }: {
  card: Card;
  hiddenPartner: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="solo-call-title"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(28rem,calc(100%-2rem))]
        bg-amber-50 dark:bg-amber-950 border-2 border-amber-500 rounded-lg shadow-lg p-4 text-left"
    >
      <div id="solo-call-title" className="font-semibold text-amber-900 dark:text-amber-100">
        You hold <CardText card={card} />. Play alone?
      </div>
      <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
        Calling your own card means no partner: you must win the contract alone against all three other players.
        {hiddenPartner
          ? <> They will not know that until you play <CardText card={card} />.</>
          : ' With hidden partner off, they will know straight away.'}
      </p>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1 text-sm rounded border border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900">
          Cancel
        </button>
        <button onClick={onConfirm} className="px-3 py-1 text-sm rounded bg-amber-600 text-white font-medium hover:bg-amber-700">
          Call it and play alone
        </button>
      </div>
    </div>
  );
}

function PartnerCallPanel({ contract, hiddenPartner, hand, availableCallCards, onCallCard }: {
  contract: Contract;
  hiddenPartner: boolean;
  hand: Card[];
  availableCallCards: Card[];
  onCallCard: (card: Card) => void;
}) {
  // Mounted only during the human's PARTNER_CALL, so this default is the real trump suit.
  const [suit, setSuit] = useState<Suit>(contract.trumpSuit ?? 'Spades');
  // A card from your own hand waits here until the warning is confirmed.
  const [pendingSolo, setPendingSolo] = useState<Card | null>(null);
  const holds = (card: Card) => hand.some(c => cardsEqual(c, card));

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
      <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
        You won the auction. Now choose one card you don't hold.
      </h3>
      <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
        Whoever holds that card becomes your partner.
        {hiddenPartner && ' Only they will know until the card is played.'}
        {' '}Contract: <BidText bid={contract} /> ({contractTerms(contract)}).
      </p>

      <StrainPicker options={SUITS} selected={suit} enabled={s => availableCallCards.some(c => c.suit === s)} onSelect={setSuit} />

      <div className="flex flex-wrap gap-2 justify-center">
        {RANKS.map(rank => {
          const card = { suit, rank };
          const own = holds(card);
          return (
            <button
              key={rank}
              onClick={() => (own ? setPendingSolo(card) : onCallCard(card))}
              disabled={pendingSolo !== null || !availableCallCards.some(c => cardsEqual(c, card))}
              title={own ? 'In your hand: calling it means playing alone' : undefined}
              className={`px-2 py-1 text-xs font-medium rounded border transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed
                bg-white dark:bg-gray-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30
                ${own
                  ? 'border-dashed border-amber-500 text-gray-400 dark:text-gray-500'
                  : 'border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200'}`}
            >
              {rank} {SUIT_SYMBOLS[suit]}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3 text-center">
        Cards in your own hand are dashed: calling one means playing alone. A common choice is
        {contract.trumpSuit ? ' the highest trump you don\'t hold.' : ' an ace you don\'t hold.'}
      </p>

      {pendingSolo && (
        <SoloCallWarning
          card={pendingSolo}
          hiddenPartner={hiddenPartner}
          onConfirm={() => onCallCard(pendingSolo)}
          onCancel={() => setPendingSolo(null)}
        />
      )}
    </div>
  );
}

function TrickArea({ state, awaitingContinue, onContinue }: {
  state: GameState;
  awaitingContinue: boolean;
  onContinue: () => void;
}) {
  // Space/Enter is the same button as "Next trick", but only while one is waiting.
  useEffect(() => {
    if (!awaitingContinue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Spacebar') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      onContinue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [awaitingContinue, onContinue]);

  if (state.phase !== 'TRICK_PLAY' && state.phase !== 'HAND_RESULT') return null;

  const current = state.tricks.current;
  const lastCompleted = state.tricks.completed[state.tricks.completed.length - 1];
  // Keep the finished trick on the table until the next lead so the last card is visible.
  const shown = current && current.cards.length > 0 ? current : lastCompleted ?? current;
  const trumpSuit = state.contract?.trumpSuit ?? null;
  const slot = (p: PlayerIndex) => {
    const played = shown?.cards.find(c => c.player === p);
    return (
      <div className="w-16 h-22 flex items-center justify-center">
        {played && (
          <CardComponent
            card={played.card}
            faceUp={true}
            size="medium"
            trump={trumpSuit !== null && played.card.suit === trumpSuit}
            lead={shown?.leader === p}
            className={shown?.winner === p && shown.cards.length === 4 ? 'ring-2 ring-green-500' : ''}
          />
        )}
      </div>
    );
  };

  const verdict = shown && shown.cards.length === 4 ? trickVerdictText(shown) : null;
  const legend = trumpSuit
    ? 'Follow the led suit if you can · trump beats every other suit · otherwise the highest card of the led suit wins · the winner leads next'
    : 'Follow the led suit if you can · the highest card of the led suit wins · the winner leads next';

  const p = state.partnerships;
  const publicSides = isPartnershipPublic(state);
  const declarerSide = p ? countTricksWon(state.tricks.completed, p) : 0;
  const defenderSide = state.tricks.completed.length - declarerSide;
  const wonBy = (seat: PlayerIndex) => state.tricks.completed.filter(t => t.winner === seat).length;

  return (
    <div className="relative flex-1 flex items-center justify-center p-4 min-h-64">
      <div className="flex flex-col items-center gap-2">
        {slot(2)}
        <div className="flex gap-8">
          {slot(1)}
          {slot(3)}
        </div>
        {slot(0)}

        {verdict && (
          <p className="max-w-96 text-center text-sm text-gray-700 dark:text-gray-200">{verdict}</p>
        )}

        {awaitingContinue && (
          <button
            onClick={onContinue}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium shadow hover:bg-blue-700 transition-colors"
          >
            Next trick →
          </button>
        )}

        {state.phase === 'TRICK_PLAY' && (
          <p className="max-w-96 text-center text-xs text-gray-500 dark:text-gray-400">{legend}</p>
        )}
      </div>

      <div className="absolute bottom-2 left-2 text-sm text-gray-600 dark:text-gray-300">
        Trick {Math.min(state.tricks.completed.length + 1, 13)} / 13
      </div>

      {p && state.contract && (
        <div className="absolute bottom-2 right-2 text-xs text-gray-600 dark:text-gray-300 text-right">
          {publicSides ? (
            <>
              <div>
                {isSolo(p) ? `${PLAYER_NAMES[p.declarer]} alone` : `${PLAYER_NAMES[p.declarer]} + ${PLAYER_NAMES[p.partner]}`}:{' '}
                <strong>{declarerSide}</strong> / {state.contract.tricksRequired} needed
              </div>
              <div>
                {p.defenders.map(d => PLAYER_NAMES[d]).join(' + ')}: <strong>{defenderSide}</strong>
              </div>
            </>
          ) : (
            <>
              <div>Partner not yet revealed. {PLAYER_NAMES[p.declarer]} needs {state.contract.tricksRequired}.</div>
              <div>Tricks: {PLAYERS.map(s => `${PLAYER_NAMES[s][0]} ${wonBy(s)}`).join(' · ')}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Contract, called card and the human's side. Spells out only what South may know. */
function ContractBadge({ state }: { state: GameState }) {
  if (!state.contract || state.auction.declarer === null) return null;
  const contract = state.contract;
  const declarer = state.auction.declarer;
  const p = state.partnerships;
  const called = state.calledCard;

  const known = getSideKnowledge(state, 0);
  const holderKnown = p !== null && (isPartnershipPublic(state) || p.partner === 0);

  let side: string | null = null;
  if (p && called) {
    if (p.declarer === 0 && isSolo(p)) {
      side = isPartnershipPublic(state)
        ? 'You play alone against all three.'
        : 'You play alone against all three. They do not know yet.';
    } else if (p.declarer === 0) {
      side = holderKnown ? `Your partner is ${PLAYER_NAMES[p.partner]}.` : 'Your partner is whoever holds the called card. Not yet known.';
    } else if (p.partner === 0) {
      side = isPartnershipPublic(state)
        ? `You are ${PLAYER_NAMES[p.declarer]}'s partner.`
        : `You hold the called card: you are ${PLAYER_NAMES[p.declarer]}'s secret partner.`;
    } else {
      const allies = p.defenders.filter(d => d !== 0 && known[d] === 'ally').map(d => PLAYER_NAMES[d]);
      if (allies.length === 0) {
        side = `You defend against ${PLAYER_NAMES[p.declarer]}. Their partner is not yet known: it could be either of the other two players, or nobody.`;
      } else if (isSolo(p)) {
        side = `You defend with ${allies.join(' and ')}. ${PLAYER_NAMES[p.declarer]} called their own card and plays alone.`;
      } else {
        side = `You defend with ${allies.join(' and ')}.`;
      }
    }
  }

  const pill = 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 px-3 py-1 rounded-full';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={pill}>
        <BidText bid={contract} /> by {PLAYER_NAMES[declarer]} ({contractTerms(contract)})
      </span>
      {called && p && (
        <span className={pill}>
          Called <CardText card={called} />
          {holderKnown ? <>, held by <strong>{PLAYER_NAMES[p.partner]}</strong>{isSolo(p) && ' (declarer, alone)'}</> : ', holder hidden'}
        </span>
      )}
      {side && <span className={`${pill} font-medium`}>{side}</span>}
    </div>
  );
}

/** Trick-by-trick record of the hand, shown in the result panel. */
function HandHistory({ state }: { state: GameState }) {
  const called = state.calledCard;
  const cell = (t: Trick, seat: PlayerIndex) => {
    const play = t.cards.find(c => c.player === seat);
    if (!play) return <td key={seat} />;
    const isCalled = called !== null && cardsEqual(play.card, called);
    const won = t.winner === seat;
    return (
      <td key={seat} className={`px-2 py-0.5 text-center ${won ? 'bg-green-100 dark:bg-green-900/40 rounded' : ''}`}>
        <CardText card={play.card} />
        {t.leader === seat && <span className="text-gray-400 text-[10px] ml-0.5">L</span>}
        {isCalled && <span className="text-[10px] ml-0.5" title="called card">★</span>}
      </td>
    );
  };

  return (
    <div className="text-left text-sm">
      <div className="font-semibold mb-1">Auction</div>
      <ol className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs mb-3">
        {state.auction.log.map((call, i) => (
          <li key={i}>{PLAYER_NAMES[call.player]}: {call.bid ? <BidText bid={call.bid} /> : <em>pass</em>}</li>
        ))}
      </ol>

      <div className="font-semibold mb-1">Tricks</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-gray-600 dark:text-gray-300">
              <th className="px-2 py-0.5 text-left">#</th>
              {PLAYERS.map(s => <th key={s} className="px-2 py-0.5">{PLAYER_NAMES[s]}</th>)}
              <th className="px-2 py-0.5 text-left">Won</th>
            </tr>
          </thead>
          <tbody>
            {state.tricks.completed.map((t, i) => (
              <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-2 py-0.5 text-gray-600 dark:text-gray-300">{i + 1}</td>
                {PLAYERS.map(s => cell(t, s))}
                <td className="px-2 py-0.5 font-medium">{t.winner !== null ? PLAYER_NAMES[t.winner] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-gray-600 dark:text-gray-300 mt-1">L = led the trick · ★ = called card · green = trick winner</div>
    </div>
  );
}

function ResultPanel({ state, onNewHand }: { state: GameState; onNewHand: () => void }) {
  if (state.phase !== 'HAND_RESULT' || !state.result || !state.contract || !state.partnerships) return null;

  const made = state.result.contractMade;
  const { declarer, partner } = state.partnerships;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className={`bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto text-center border-4 ${made ? 'border-green-500' : 'border-red-500'}`}>
        <h2 className={`text-3xl font-bold mb-3 ${made ? 'text-green-600' : 'text-red-600'}`}>
          {made ? 'CONTRACT MADE' : 'CONTRACT FAILED'}
        </h2>

        <div className="space-y-1 mb-4">
          <p>Contract: <BidText bid={state.contract} /> by <strong>{PLAYER_NAMES[declarer]}</strong> ({contractTerms(state.contract)})</p>
          {partner === declarer ? (
            <p>Partner: <strong>none</strong>{state.calledCard && <> ({PLAYER_NAMES[declarer]} called their own <CardText card={state.calledCard} /> and played alone)</>}</p>
          ) : (
            <p>Partner: <strong>{PLAYER_NAMES[partner]}</strong>{state.calledCard && <> (held <CardText card={state.calledCard} />)</>}</p>
          )}
          <p>Tricks won: <strong>{state.result.tricksWonByDeclarer} / {state.contract.tricksRequired}</strong></p>
        </div>

        <HandHistory state={state} />

        <button
          onClick={onNewHand}
          className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Play Next Hand
        </button>
      </div>
    </div>
  );
}

function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const steps = [
    'Deal: everyone receives 13 private cards. A hand scores A 4, K 3, Q 2, J 1, plus 1 for each card past the fourth in a suit. With the wash rule on (the default), if any hand has fewer than 4 points the deal is a wash: the cards are shuffled and redealt.',
    "Bid: a bid is a level from 1 to 7 plus a strain (a trump suit, or no trump). Your side must win level + 6 tricks, so 1♠ needs 7 and 7NT needs all 13. A higher level wins; at the same level NT > ♠ > ♥ > ♣ > ♦. You don't know who your partner is yet!",
    'The first bidder may not pass. The auction ends when only one bidder is left, and their bid becomes the contract.',
    "Call a card: the declarer names a card they don't hold. Whoever has it becomes their partner. With hidden partner on (the default), only that player knows until the card is played. That is the price of losing the auction: the declarer knows their side from the start, while each defender plays without knowing which of the other two is a fellow defender and which is the declarer's secret partner. A declarer confident of winning alone may call a card they hold: they then have no partner and face all three, who may not realise until that card appears.",
    "Play: in a suit contract the player to declarer's left leads; in no trump the declarer leads. Follow suit if you can. Trumps beat everything else; otherwise the highest card of the led suit wins, and the winner leads next.",
    'Check the contract: if the declarer and partner win at least level + 6 tricks, they succeed.',
  ];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">How to Play Singaporean Floating Bridge</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <ol className="space-y-4 text-left text-[15px] leading-relaxed">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="pt-0.5 text-gray-800 dark:text-gray-200">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">
          <div className="font-semibold mb-2">Worked example</div>
          <p>South bids 1♥. West bids 1♠. North bids 2♣. East passes. South bids 2♥. West passes. North passes.</p>
          <p className="mt-1">South wins the auction with 2♥: Hearts are trump and South's side needs 8 tricks. South does not hold K♥, so South calls K♥. North holds K♥, so North becomes South's partner. West and East defend.</p>
          <p className="mt-1">West, on South's left, leads the first trick. With hidden partner on, only North knows the partnership until K♥ is played. Had South won with 2NT instead, South would lead.</p>
          <p className="mt-1">Note what West and East give up by losing the auction: neither knows whether the other is a fellow defender or South's secret partner, while South and North both know their own side.</p>
          <p className="mt-2 font-medium">Note: North was NOT South's partner during the auction. Partnerships only exist once a card is called.</p>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          This implements one Singaporean ruleset. Local variants exist. Bidding uses Contract Bridge's book of six, but suits rank ♠ &gt; ♥ &gt; ♣ &gt; ♦ and there are no fixed partners, no dummy and no doubling.
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
  rules,
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
  onSetRules,
  showTutorial,
  pauseAfterTrick,
  awaitingContinue,
  onSetPauseAfterTrick,
  onContinue,
}: GameTableProps) {
  // An illegal card shakes for the length of the CSS animation and flashes the hint line.
  const [shakenKey, setShakenKey] = useState<string | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shakeTimer.current !== null) clearTimeout(shakeTimer.current); }, []);
  const flashIllegal = (card: Card) => {
    if (shakeTimer.current !== null) clearTimeout(shakeTimer.current);
    setShakenKey(cardKey(card));
    shakeTimer.current = setTimeout(() => {
      setShakenKey(null);
      shakeTimer.current = null;
    }, 400);
  };

  const legalPlayKeys = new Set(legalPlays.map(cardKey));
  const humanCalling = state.phase === 'PARTNER_CALL' && isHumanTurn && state.contract;

  // The human must choose a card right now: dim the illegal ones and coach the choice.
  const humanPlaying = state.phase === 'TRICK_PLAY' && isHumanTurn && legalPlays.length > 0;
  const trumpSuit = state.contract?.trumpSuit ?? null;
  const ledSuit = state.tricks.current?.ledSuit ?? null;
  const suitMark = (s: Suit) => <span className={strainClass(s)}>{SUIT_SYMBOLS[s]}</span>;

  let hintText: ReactNode = null;
  if (humanPlaying) {
    if (ledSuit === null) {
      hintText = <>You lead - any card.</>;
    } else if (humanHand.some(c => c.suit === ledSuit)) {
      hintText = <>{suitMark(ledSuit)} was led - you must follow with a {suitMark(ledSuit)}.</>;
    } else {
      const canRuff = trumpSuit !== null && humanHand.some(c => c.suit === trumpSuit);
      hintText = <>You have no {suitMark(ledSuit)} - you may play anything{canRuff ? ' (a trump beats the led suit)' : ''}.</>;
    }
  }
  const hint = hintText && (
    <p
      className={`text-sm text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded transition-all
        ${shakenKey !== null ? 'font-semibold ring-2 ring-amber-400' : ''}`}
    >
      {hintText}
    </p>
  );
  const hiddenHand = (p: PlayerIndex, position: 'north' | 'west' | 'east') => (
    <PlayerArea name={PLAYER_NAMES[p]} hand={state.hands[p]} isHuman={false} faceUp={false} position={position} />
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 text-gray-900 dark:text-gray-100 p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Singaporean Floating Bridge</h1>
          <button onClick={onOpenTutorial} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
            <HelpCircle className="w-4 h-4" /> How to play
          </button>
          <label
            className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1 cursor-pointer"
            title="Only the holder of the called card knows they are partner until that card is played. The defenders do not know who is on their side either."
          >
            <input
              type="checkbox"
              checked={rules.hiddenPartner}
              onChange={e => onSetRules({ hiddenPartner: e.target.checked })}
            />
            Hidden partner
            {rules.hiddenPartner !== state.rules.hiddenPartner && (
              <span className="text-xs text-amber-600 dark:text-amber-400">(from next hand)</span>
            )}
          </label>
          <label
            className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1 cursor-pointer"
            title="Redeal unless every hand has at least this many points: A 4, K 3, Q 2, J 1, plus 1 for each card past the fourth in a suit."
          >
            <input
              type="checkbox"
              checked={rules.wash}
              onChange={e => onSetRules({ wash: e.target.checked })}
            />
            Wash under
            <input
              type="number"
              min={MIN_WASH_POINTS}
              max={MAX_WASH_POINTS}
              value={rules.washMinPoints}
              disabled={!rules.wash}
              onChange={e => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= MIN_WASH_POINTS && n <= MAX_WASH_POINTS) onSetRules({ washMinPoints: n });
              }}
              className="w-12 px-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-50"
              aria-label="Wash minimum points"
            />
            points
            {(rules.wash !== state.rules.wash || rules.washMinPoints !== state.rules.washMinPoints) && (
              <span className="text-xs text-amber-600 dark:text-amber-400">(from next hand)</span>
            )}
          </label>
          <label
            className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1 cursor-pointer"
            title="Hold the finished trick on the table until you press Next. Recommended while learning."
          >
            <input
              type="checkbox"
              checked={pauseAfterTrick}
              onChange={e => onSetPauseAfterTrick(e.target.checked)}
            />
            Pause after each trick
          </label>
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
            <TrickArea state={state} awaitingContinue={awaitingContinue} onContinue={onContinue} />
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
          dimIllegal={humanPlaying}
          onIllegalClick={flashIllegal}
          shakenKey={shakenKey}
          trumpSuit={trumpSuit}
          hint={hint}
        />

        <div className="w-full max-w-2xl mt-4">
          {state.phase === 'AUCTION' && <AuctionLog state={state} />}
          {state.phase === 'AUCTION' && isHumanTurn && (
            <BiddingPanel state={state} legalBids={legalBids} canPass={canPass} onBid={onBid} onPass={onPass} />
          )}
          {humanCalling && (
            <PartnerCallPanel
              contract={state.contract!}
              hiddenPartner={state.rules.hiddenPartner}
              hand={humanHand}
              availableCallCards={availableCallCards}
              onCallCard={onCallCard}
            />
          )}
        </div>
      </div>

      <ResultPanel state={state} onNewHand={onNewHand} />

      {showTutorial && <TutorialOverlay onClose={onCloseTutorial} />}
    </div>
  );
}
