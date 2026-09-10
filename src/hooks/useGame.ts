import { useState, useCallback, useEffect } from 'react';
import type { GameState, Card, Suit } from '../engine/types';
import {
  createInitialState, startAuction, makeBid, pass,
  callPartner, playCard, startNextHand, getLegalPlays,
  getGameStatusText
} from '../engine/gameEngine';
import { getLegalBids } from '../engine/types';
import { makeAiDecision } from '../ai/aiPlayer';

const AI_PHASES: ReadonlySet<GameState['phase']> = new Set(['AUCTION', 'PARTNER_CALL', 'TRICK_PLAY']);

function isAiTurn(state: GameState): boolean {
  return state.currentPlayer !== null && state.currentPlayer !== 0 && AI_PHASES.has(state.phase);
}

/** Apply exactly one AI move so the UI can animate each play. */
function advanceOneAi(current: GameState): GameState {
  if (!isAiTurn(current)) return current;
  const player = current.currentPlayer!;
  const decision = makeAiDecision(current, player);

  if (decision.action === 'bid' && decision.bid) {
    return makeBid(current, player, decision.bid.tricks, decision.bid.suit);
  }
  if (decision.action === 'pass') return pass(current, player);
  if (decision.action === 'call' && decision.card) return callPartner(current, player, decision.card);
  if (decision.action === 'play' && decision.card) return playCard(current, player, decision.card);
  return current;
}

export function useGame() {
  const [state, setState] = useState<GameState>(() => startAuction(createInitialState(0)));
  const [showTutorial, setShowTutorial] = useState(true);

  // Drive AI turns one move at a time. A fresh trick after a completed one gets a
  // longer pause so the finished trick stays visible.
  useEffect(() => {
    if (!isAiTurn(state)) return;
    const startingNewTrick = state.phase === 'TRICK_PLAY'
      && state.tricks.current?.cards.length === 0
      && state.tricks.completed.length > 0;
    const timer = setTimeout(() => {
      setState(prev => advanceOneAi(prev));
    }, startingNewTrick ? 1200 : 600);
    return () => clearTimeout(timer);
  }, [state]);

  const handleNewHand = useCallback(() => {
    setState(prev => startAuction(startNextHand(prev)));
  }, []);

  const handleHumanBid = useCallback((tricks: number, suit: Suit) => {
    setState(prev => makeBid(prev, 0, tricks, suit));
  }, []);

  const handleHumanPass = useCallback(() => {
    setState(prev => pass(prev, 0));
  }, []);

  const handleHumanCallCard = useCallback((card: Card) => {
    setState(prev => callPartner(prev, 0, card));
  }, []);

  const handleHumanPlayCard = useCallback((card: Card) => {
    setState(prev => playCard(prev, 0, card));
  }, []);

  const isHumanTurn = state.currentPlayer === 0;

  // Legal bids for the human. Empty unless it is actually the human's turn to bid.
  const legalBids = state.phase === 'AUCTION' && isHumanTurn
    ? getLegalBids(state.auction.currentBid, 0, state.auction.bids.length === 0)
    : [];

  const legalPlays = state.phase === 'TRICK_PLAY' && isHumanTurn
    ? getLegalPlays(state, 0)
    : [];

  // Cards the human may call: any card not in the human's hand.
  const availableCallCards: Card[] = [];
  if (state.phase === 'PARTNER_CALL' && isHumanTurn) {
    const suits: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
    const ranks: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    for (const suit of suits) {
      for (const rank of ranks) {
        if (!state.hands[0].some(c => c.suit === suit && c.rank === rank)) {
          availableCallCards.push({ suit, rank });
        }
      }
    }
  }

  return {
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
    statusText: getGameStatusText(state),
    isHumanTurn,
  };
}
