import { useState, useCallback, useEffect } from 'react';
import type { GameState, Card, Suit, Bid, GameRules } from '../engine/types';
import {
  createInitialState, startAuction, makeBid, pass,
  callPartner, playCard, startNextHand, getLegalPlays,
  getGameStatusText, canPass, setRules
} from '../engine/gameEngine';
import { getLegalBids, cardsEqual, createDeck, findCardInHand, DEFAULT_RULES } from '../engine/types';

const RULES_KEY = 'singaporean-bridge.rules';

function loadRules(): GameRules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? { ...DEFAULT_RULES, ...JSON.parse(raw) } : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

function saveRules(rules: GameRules) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // Storage unavailable: the choice just lives for this page load.
  }
}
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

// Legality queries for the human seat. Each handler re-checks against the
// state it is applied to, so a stale click can never throw inside setState.
function humanLegalBids(state: GameState): Bid[] {
  return state.phase === 'AUCTION' && state.currentPlayer === 0
    ? getLegalBids(state.auction.currentBid, 0)
    : [];
}

function humanLegalPlays(state: GameState): Card[] {
  return state.phase === 'TRICK_PLAY' && state.currentPlayer === 0 ? getLegalPlays(state, 0) : [];
}

function humanCallableCards(state: GameState): Card[] {
  if (state.phase !== 'PARTNER_CALL' || state.currentPlayer !== 0) return [];
  return createDeck().filter(card => findCardInHand(state.hands[0], card) === -1);
}

export function useGame() {
  // The player's chosen rules. They reach the table immediately while the auction is
  // still open (nothing about partners is known yet), otherwise from the next deal:
  // flipping mid-play would either leak or un-reveal the partner.
  const [rules, setRulesState] = useState<GameRules>(loadRules);
  const [state, setState] = useState<GameState>(() => startAuction(createInitialState(0, rules)));
  const [showTutorial, setShowTutorial] = useState(true);

  const handleSetRules = useCallback((change: Partial<GameRules>) => {
    setRulesState(prevRules => {
      const nextRules = { ...prevRules, ...change };
      saveRules(nextRules);
      setState(prev => (prev.phase === 'DEALING' || prev.phase === 'AUCTION' ? setRules(prev, nextRules) : prev));
      return nextRules;
    });
  }, []);

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
    setState(prev => startAuction(setRules(startNextHand(prev), rules)));
  }, [rules]);

  const handleHumanBid = useCallback((tricks: number, suit: Suit) => {
    setState(prev => humanLegalBids(prev).some(b => b.tricks === tricks && b.suit === suit)
      ? makeBid(prev, 0, tricks, suit)
      : prev);
  }, []);

  const handleHumanPass = useCallback(() => {
    setState(prev => (canPass(prev, 0) ? pass(prev, 0) : prev));
  }, []);

  const handleHumanCallCard = useCallback((card: Card) => {
    setState(prev => humanCallableCards(prev).some(c => cardsEqual(c, card))
      ? callPartner(prev, 0, card)
      : prev);
  }, []);

  const handleHumanPlayCard = useCallback((card: Card) => {
    setState(prev => humanLegalPlays(prev).some(c => cardsEqual(c, card))
      ? playCard(prev, 0, card)
      : prev);
  }, []);

  return {
    state,
    rules,
    showTutorial,
    setShowTutorial,
    handleNewHand,
    handleSetRules,
    handleHumanBid,
    handleHumanPass,
    handleHumanCallCard,
    handleHumanPlayCard,
    legalBids: humanLegalBids(state),
    legalPlays: humanLegalPlays(state),
    availableCallCards: humanCallableCards(state),
    canPass: canPass(state, 0),
    statusText: getGameStatusText(state),
    isHumanTurn: state.currentPlayer === 0,
  };
}
