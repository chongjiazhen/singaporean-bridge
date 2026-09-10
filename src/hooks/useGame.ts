import { useState, useCallback, useEffect } from 'react';
import type { GameState, Card, Suit } from '../engine/types';
import {
  createInitialState, startAuction, makeBid, pass,
  callPartner, playCard, startNextHand, getLegalPlays,
  getGameStatusText
} from '../engine/gameEngine';
import { getLegalBids } from '../engine/types';
import { makeAiDecision } from '../ai/aiPlayer';

export function useGame() {
  const [state, setState] = useState<GameState>(() => createInitialState(0));
  const [autoPlay, setAutoPlay] = useState(false);
  const [showTutorial, setShowTutorial] = useState(true);

  // Internal recursive AI advancement
  function advanceAiInternal(current: GameState): GameState {
    if (current.currentPlayer === 0 || current.currentPlayer === null) return current;
    if (current.phase === 'AUCTION' || current.phase === 'PARTNER_CALL' || current.phase === 'TRICK_PLAY') {
      const decision = makeAiDecision(current, current.currentPlayer);
      let newState = current;

      if (decision.action === 'bid' && decision.bid) {
        newState = makeBid(newState, current.currentPlayer, decision.bid.tricks, decision.bid.suit);
      } else if (decision.action === 'pass') {
        newState = pass(newState, current.currentPlayer);
      } else if (decision.action === 'call' && decision.card) {
        newState = callPartner(newState, current.currentPlayer, decision.card);
      } else if (decision.action === 'play' && decision.card) {
        newState = playCard(newState, current.currentPlayer, decision.card);
      }

      return advanceAiInternal(newState);
    }
    return current;
  }

  // Watch for AI turns and auto-advance
  useEffect(() => {
    if (autoPlay && state.currentPlayer !== 0 && state.currentPlayer !== null &&
        (state.phase === 'AUCTION' || state.phase === 'PARTNER_CALL' || state.phase === 'TRICK_PLAY')) {
      const timer = setTimeout(() => {
        setState(prev => advanceAiInternal(prev));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state, autoPlay]);

  const handleNewHand = useCallback(() => {
    setState(prev => startNextHand(prev));
    setAutoPlay(false);
  }, []);

  const handleStartAuction = useCallback(() => {
    setState(prev => {
      let newState = startAuction(prev);
      // If first bidder is AI, start auto-advancing
      if (newState.currentPlayer !== 0) {
        newState = advanceAiInternal(newState);
      }
      return newState;
    });
    setAutoPlay(true);
  }, []);

  const handleHumanBid = useCallback((tricks: number, suit: Suit) => {
    setState(prev => {
      let newState = makeBid(prev, 0, tricks, suit);
      return advanceAiInternal(newState);
    });
  }, []);

  const handleHumanPass = useCallback(() => {
    setState(prev => {
      let newState = pass(prev, 0);
      return advanceAiInternal(newState);
    });
  }, []);

  const handleHumanCallCard = useCallback((card: Card) => {
    setState(prev => {
      let newState = callPartner(prev, 0, card);
      return advanceAiInternal(newState);
    });
  }, []);

  const handleHumanPlayCard = useCallback((card: Card) => {
    setState(prev => {
      let newState = playCard(prev, 0, card);
      return advanceAiInternal(newState);
    });
  }, []);

  // Get available bids for human player
  const legalBids = getLegalBids(state.auction.currentBid, 0, state.auction.bids.length === 0);

  // Get legal plays for human
  const legalPlays = state.phase === 'TRICK_PLAY' && state.currentPlayer === 0
    ? getLegalPlays(state, 0)
    : [];

  // All possible cards in the deck
  const allPossibleCards: Card[] = (() => {
    const suits: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
    const ranks: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const cards: Card[] = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({ suit, rank });
      }
    }
    return cards;
  })();

  // Filter to cards NOT in human's hand
  const availableCallCards = state.phase === 'PARTNER_CALL' && state.currentPlayer === 0
    ? allPossibleCards.filter(card => !state.hands[0].some(c => c.suit === card.suit && c.rank === card.rank))
    : [];

  return {
    state,
    autoPlay,
    setAutoPlay,
    showTutorial,
    setShowTutorial,
    handleNewHand,
    handleStartAuction,
    handleHumanBid,
    handleHumanPass,
    handleHumanCallCard,
    handleHumanPlayCard,
    legalBids,
    legalPlays,
    availableCallCards,
    statusText: getGameStatusText(state),
    isHumanTurn: state.currentPlayer === 0 && state.currentPlayer !== null,
  };
}