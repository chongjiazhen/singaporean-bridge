import { useState, useCallback, useEffect } from 'react';
import type { GameState, Card, Strain, Bid, GameRules } from '../engine/types';
import {
  createInitialState, startAuction, makeBid, pass,
  callPartner, playCard, startNextHand, getLegalPlays,
  getGameStatusText, canPass, setRules
} from '../engine/gameEngine';
import { getLegalBids, cardsEqual, createDeck, DEFAULT_RULES } from '../engine/types';

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

const PAUSE_AFTER_TRICK_KEY = 'singaporean-bridge.pauseAfterTrick';

function loadPauseAfterTrick(): boolean {
  try {
    const raw = localStorage.getItem(PAUSE_AFTER_TRICK_KEY);
    return raw !== null ? JSON.parse(raw) : true;
  } catch {
    return true;
  }
}

function savePauseAfterTrick(on: boolean) {
  try {
    localStorage.setItem(PAUSE_AFTER_TRICK_KEY, JSON.stringify(on));
  } catch {
    // Storage unavailable: the choice just lives for this page load.
  }
}
import { makeAiDecision } from '../ai/aiPlayer';
import { makeTransport, type Transport, type TransportBroker } from '../network/transport';

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
    return makeBid(current, player, decision.bid.level, decision.bid.strain);
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

// True once a trick has finished and is sitting on the table waiting for the
// player to acknowledge it, so it doesn't get swept away unread.
function computeAwaitingContinue(state: GameState, pauseAfterTrick: boolean, resumedAt: number): boolean {
  return pauseAfterTrick
    && state.phase === 'TRICK_PLAY'
    && state.tricks.current !== null
    && state.tricks.current.cards.length === 0
    && state.tricks.completed.length > 0
    && state.tricks.completed.length !== resumedAt;
}

/** Every card is callable, including your own (play alone); the UI asks for confirmation on those. */
function humanCallableCards(state: GameState): Card[] {
  if (state.phase !== 'PARTNER_CALL' || state.currentPlayer !== 0) return [];
  return createDeck();
}

export type UseGameReturn = {
  state: GameState;
  rules: GameRules;
  showTutorial: boolean;
  setShowTutorial: (v: boolean) => void;
  pauseAfterTrick: boolean;
  awaitingContinue: boolean;
  handleNewHand: () => void;
  handleSetRules: (change: Partial<GameRules>) => void;
  handleSetPauseAfterTrick: (on: boolean) => void;
  handleContinue: () => void;
  handleHumanBid: (level: number, strain: Strain) => void;
  handleHumanPass: () => void;
  handleHumanCallCard: (card: Card) => void;
  handleHumanPlayCard: (card: Card) => void;
  legalBids: Bid[];
  legalPlays: Card[];
  availableCallCards: Card[];
  canPass: boolean;
  statusText: string;
  isHumanTurn: boolean;
  /** 'solo' when no transport is involved; 'host' or 'peer' in multiplayer. */
  mode: 'solo' | 'host' | 'peer';
};

/**
 * The multiplayer game hook. State is authoritative in the transport: in host
 * mode the transport drives the engine and broadcasts; in peer mode it renders
 * incoming snapshots and the UI forwards human actions back to the host.
 */
function multiplayerUseGame(opts: {
  roomKey: string;
  isHost: boolean;
  broker?: TransportBroker;
}): UseGameReturn {
  const [transport, setTransport] = useState<Transport | null>(null);

  // Create the transport once; clean it up on unmount.
  useEffect(() => {
    const handle = makeTransport({
      roomKey: opts.roomKey,
      isHost: opts.isHost,
      hostSeat: 0,
      broker: opts.broker,
    });
    handle.then((t) => {
      setTransport(t);
    });
    return () => { void handle.then((t) => t.destroy()); };
  }, [opts.roomKey, opts.isHost]);

  const [rules] = useState<GameRules>(loadRules);
  const [pauseAfterTrick, setPauseAfterTrickState] = useState<boolean>(loadPauseAfterTrick);
  const [state, setState] = useState<GameState>(() =>
    startAuction(createInitialState(0, rules)));

  // The transport is the source of truth. In host mode it feeds the engine;
  // in peer mode the UI renders the received snapshot (no local mutation).
  // Register synchronously on resolve so no snapshot is missed.
  useEffect(() => {
    if (!transport) return;
    transport.onGameState((snapshot) => setState(snapshot));
    return () => { transport.onGameState(() => {}); };
  }, [transport]);

  const awaitingContinue = computeAwaitingContinue(state, pauseAfterTrick, 0);

  const handleNewHand = useCallback(() => {}, []);
  const handleSetRules = useCallback(() => {}, [pauseAfterTrick]);
  const handleSetPauseAfterTrick = useCallback((on: boolean) => {
    setPauseAfterTrickState(on);
    savePauseAfterTrick(on);
  }, []);
  const handleContinue = useCallback(() => {}, []);

  // Multiplayer actions forward to the transport; the transport applies locally
  // in host mode and broadcasts, or forwards to the host in peer mode.
  const handleHumanBid = useCallback((level: number, strain: Strain) => {
    if (!transport) return;
    transport.sendBid(level, strain);
  }, [transport]);

  const handleHumanPass = useCallback(() => {
    if (!transport) return;
    transport.sendPass();
  }, [transport]);

  const handleHumanCallCard = useCallback((card: Card) => {
    if (!transport) return;
    transport.sendCallPartner(card);
  }, [transport]);

  const handleHumanPlayCard = useCallback((card: Card) => {
    if (!transport) return;
    transport.sendPlayCard(card);
  }, [transport]);

  return {
    state,
    rules,
    showTutorial: false,
    setShowTutorial: () => {},
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
    legalBids: humanLegalBids(state),
    legalPlays: awaitingContinue ? [] : humanLegalPlays(state),
    availableCallCards: humanCallableCards(state),
    canPass: canPass(state, state.currentPlayer ?? 0),
    statusText: getGameStatusText(state),
    isHumanTurn: state.currentPlayer === 0,
    mode: opts.isHost ? 'host' : 'peer',
  };
}

/** Solo game: the player is seat 0, no transport. Existing behaviour, unchanged. */
function soloUseGame(): UseGameReturn {
  // The player's chosen rules. Hidden partner reaches the table immediately while the
  // auction is still open (nothing about partners is known yet), otherwise from the next
  // deal: flipping mid-play would either leak or un-reveal the partner. Wash rules always
  // wait for the next deal, since the current one has already been dealt.
  const [rules, setRulesState] = useState<GameRules>(loadRules);
  const [state, setState] = useState<GameState>(() => startAuction(createInitialState(0, rules)));
  const [showTutorial, setShowTutorial] = useState(true);
  const [pauseAfterTrick, setPauseAfterTrickState] = useState<boolean>(loadPauseAfterTrick);
  // Index (into tricks.completed) up to which the player has acknowledged finished
  // tricks; a completed count past this value means one is waiting to be continued.
  const [resumedAt, setResumedAt] = useState<number>(0);

  const awaitingContinue = computeAwaitingContinue(state, pauseAfterTrick, resumedAt);

  const handleSetRules = useCallback((change: Partial<GameRules>) => {
    setRulesState(prevRules => {
      const nextRules = { ...prevRules, ...change };
      saveRules(nextRules);
      setState(prev => (prev.phase === 'DEALING' || prev.phase === 'AUCTION'
        ? setRules(prev, { hiddenPartner: nextRules.hiddenPartner })
        : prev));
      return nextRules;
    });
  }, []);

  // Drive AI turns one move at a time. A fresh trick after a completed one gets a
  // longer pause so the finished trick stays visible. While awaiting the player's
  // continue, nothing advances: the finished trick stays on the table.
  useEffect(() => {
    if (!isAiTurn(state)) return;
    if (awaitingContinue) return;
    const startingNewTrick = state.phase === 'TRICK_PLAY'
      && state.tricks.current?.cards.length === 0
      && state.tricks.completed.length > 0;
    const timer = setTimeout(() => {
      setState(prev => advanceOneAi(prev));
    }, startingNewTrick ? 1200 : 600);
    return () => clearTimeout(timer);
  }, [state, awaitingContinue]);

  const handleNewHand = useCallback(() => {
    setResumedAt(0);
    setState(prev => startAuction(setRules(startNextHand(prev), rules)));
  }, [rules]);

  const handleSetPauseAfterTrick = useCallback((on: boolean) => {
    setPauseAfterTrickState(on);
    savePauseAfterTrick(on);
  }, []);

  const handleContinue = useCallback(() => {
    setResumedAt(state.tricks.completed.length);
  }, [state.tricks.completed.length]);

  const handleHumanBid = useCallback((level: number, strain: Strain) => {
    setState(prev => humanLegalBids(prev).some(b => b.level === level && b.strain === strain)
      ? makeBid(prev, 0, level, strain)
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
    setState(prev => {
      if (computeAwaitingContinue(prev, pauseAfterTrick, resumedAt)) return prev;
      return humanLegalPlays(prev).some(c => cardsEqual(c, card))
        ? playCard(prev, 0, card)
        : prev;
    });
  }, [pauseAfterTrick, resumedAt]);

  return {
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
    legalBids: humanLegalBids(state),
    legalPlays: awaitingContinue ? [] : humanLegalPlays(state),
    availableCallCards: humanCallableCards(state),
    canPass: canPass(state, 0),
    statusText: getGameStatusText(state),
    isHumanTurn: state.currentPlayer === 0,
    mode: 'solo',
  };
}

export function useGame(opts?: {
  roomKey?: string;
  isHost?: boolean;
  broker?: TransportBroker;
}): UseGameReturn {
  const mode: 'solo' | 'host' | 'peer' =
    opts?.roomKey ? (opts.isHost ? 'host' : 'peer') : 'solo';

  if (mode === 'solo') {
    return soloUseGame();
  }
  return multiplayerUseGame({
    roomKey: opts!.roomKey!,
    isHost: opts!.isHost === true,
    broker: opts?.broker,
  });
}
