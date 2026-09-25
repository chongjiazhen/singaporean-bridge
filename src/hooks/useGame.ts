import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Card,
  Strain,
  GameState,
  GameRules,
  Bid,
  PlayerIndex,
} from '../engine/types';
import {
  createInitialState,
  startAuction,
  startNextHand,
  setRules,
  makeBid,
  pass,
  callPartner,
  playCard,
  getLegalPlays,
  getGameStatusText,
  canPass,
} from '../engine/gameEngine';
import {
  cardsEqual,
  getLegalBids,
  createDeck,
  DEFAULT_RULES,
} from '../engine/types';
import { makeTransport, readHostSnapshot, type Transport, type TransportBroker } from '../network/transport';
import { makeAiDecision } from '../ai/aiPlayer';

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
function humanLegalBids(state: GameState, seat: PlayerIndex): Bid[] {
  return state.phase === 'AUCTION' && state.currentPlayer === seat
    ? getLegalBids(state.auction.currentBid, seat)
    : [];
}

function humanLegalPlays(state: GameState, seat: PlayerIndex): Card[] {
  return state.phase === 'TRICK_PLAY' && state.currentPlayer === seat ? getLegalPlays(state, seat) : [];
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
function humanCallableCards(state: GameState, seat: PlayerIndex): Card[] {
  if (state.phase !== 'PARTNER_CALL' || state.currentPlayer !== seat) return [];
  return createDeck();
}

export interface UseGameReturn {
  state: GameState;
  rules: GameRules;
  showTutorial: boolean;
  setShowTutorial: (show: boolean) => void;
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
  mode: 'solo' | 'host' | 'peer';
  seat: PlayerIndex;
  /** Set when the transport's signaling init rejected; null while healthy. */
  connectionError: string | null;
  /** Host-only: shows the "Start Game" button when true. */
  canStartGame: boolean;
  /** Host-only: called when the host clicks "Start Game". */
  handleStartGame: () => void;
}

/**
 * Unified game hook supporting solo, host, and peer modes.
 * All hooks are called unconditionally on every render to satisfy
 * React's rules of hooks; mode-specific logic branches inside callbacks.
 */
export function useGame(opts?: {
  roomKey?: string;
  isHost?: boolean;
  broker?: TransportBroker;
  /** Host-only: wait for peers before dealing. */
  waitForPeers?: boolean;
  /** Host-only: seed the deal so fresh hands are reproducible from the seed. */
  seed?: number;
}): UseGameReturn {
  const mode: 'solo' | 'host' | 'peer' =
    opts?.roomKey ? (opts.isHost ? 'host' : 'peer') : 'solo';

  const [transport, setTransport] = useState<Transport | null>(null);
  const waitForPeersRef = useRef(opts?.waitForPeers === true);
  if (opts?.waitForPeers === true) waitForPeersRef.current = true;

  // Create the transport once; clean it up on unmount.
  useEffect(() => {
    if (mode === 'solo') return;
    const isHost = opts!.isHost === true;
    const handle = makeTransport({
      roomKey: opts!.roomKey!,
      isHost,
      hostSeat: 0,
      broker: opts?.broker,
      // A host that refreshes restores its previous authoritative hand instead of
      // reshuffling. Peers never restore (they just re-subscribe to the host).
      restoreSnapshot: isHost ? readHostSnapshot(opts!.roomKey!) : undefined,
      seed: opts?.seed,
      // Forward so a host stays in DEALING (no auction, no bots) until it
      // explicitly starts the game; peers may join and be seated first.
      waitForPeers: waitForPeersRef.current,
    });
    handle.then((t: Transport) => {
      setTransport(t);
    });
    return () => { void handle.then((t: Transport) => t.destroy()); };
  }, [mode, opts?.roomKey, opts?.isHost, opts?.broker, opts?.seed, opts?.waitForPeers]);

  const [rules, setRulesState] = useState<GameRules>(loadRules);
  // Solo mode seeds a local engine here. In host/peer modes this same value is only
  // a pre-transport placeholder: the transport's authoritative GAME_STATE snapshots
  // (subscribed in the effect below) overwrite it the moment the transport is ready,
  // and the local engine is never driven in parallel. That is what keeps host and
  // peers on a single shared deal instead of each tab dealing its own.
  const [state, setState] = useState<GameState>(() =>
    mode === 'solo' ? startAuction(createInitialState(0, rules)) : createInitialState(0, rules));
  const [showTutorial, setShowTutorial] = useState(true);
  const [pauseAfterTrick, setPauseAfterTrickState] = useState<boolean>(loadPauseAfterTrick);
  const [resumedAt, setResumedAt] = useState<number>(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // The transport is the source of truth in host AND peer modes: both subscribe
  // to its authoritative GAME_STATE snapshots and let them replace the local
  // placeholder. (Solo mode has no transport and runs its own local engine.)
  // Register synchronously on resolve so no snapshot is missed.
  useEffect(() => {
    if (!transport) return;
    transport.onGameState((snapshot: GameState) => setState(snapshot));
    transport.onError((reason: string) => setConnectionError(reason));
    return () => { transport.onGameState(() => {}); transport.onError(() => {}); };
  }, [transport]);

  const awaitingContinue = computeAwaitingContinue(state, pauseAfterTrick, resumedAt);

  // Seat of the human controlling this UI: 0 in solo/host, the peer's
  // assigned seat in peer mode. Derived from the transport so the seat-gated
  // queries below are correct for whichever seat a peer actually occupies.
  const seat: PlayerIndex = mode === 'solo' ? 0 : (transport?.seat ?? 0);

  const handleSetRules = useCallback((change: Partial<GameRules>) => {
    // Rules take effect on the next deal. In solo mode we preview the change on the
    // local engine; in host/peer the authoritative engine already carries the rules
    // and a local mutation would only desync the rendered state, so we skip it.
    setRulesState((prevRules: GameRules) => {
      const nextRules = { ...prevRules, ...change };
      saveRules(nextRules);
      if (mode === 'solo') {
        setState((prev: GameState) => (prev.phase === 'DEALING' || prev.phase === 'AUCTION'
          ? setRules(prev, { hiddenPartner: nextRules.hiddenPartner })
          : prev));
      }
      return nextRules;
    });
  }, [mode]);

  // Drive AI turns one move at a time. A fresh trick after a completed one gets a
  // longer pause so the finished trick stays visible. While awaiting the player's
  // continue, nothing advances: the finished trick stays on the table.
  useEffect(() => {
    if (mode !== 'solo') return;
    if (!isAiTurn(state)) return;
    if (awaitingContinue) return;
    const startingNewTrick = state.phase === 'TRICK_PLAY'
      && state.tricks.current?.cards.length === 0
      && state.tricks.completed.length > 0;
    const timer = setTimeout(() => {
      setState(prev => advanceOneAi(prev));
    }, startingNewTrick ? 1200 : 600);
    return () => clearTimeout(timer);
  }, [mode, state, awaitingContinue]);

  const handleNewHand = useCallback(() => {
    setResumedAt(0);
    if (mode === 'solo') {
      setState((prev: GameState) => startAuction(setRules(startNextHand(prev), rules)));
      return;
    }
    // Host: deal the next hand on the authoritative engine so every peer sees the
    // same new deal. Peer: no-op; the host's next snapshot drives it.
    if (mode === 'host') {
      transport?.sendNewHand();
    }
  }, [mode, rules, transport]);

  const handleStartGame = useCallback(() => {
    if (mode === 'host') {
      transport?.startGame();
    }
  }, [mode, transport]);

  const handleSetPauseAfterTrick = useCallback((on: boolean) => {
    setPauseAfterTrickState(on);
    savePauseAfterTrick(on);
  }, []);

  const handleContinue = useCallback(() => {
    setResumedAt(state.tricks.completed.length);
  }, [state.tricks.completed.length]);

  const handleHumanBid = useCallback((level: number, strain: Strain) => {
    if (mode === 'solo') {
      setState((prev: GameState) => humanLegalBids(prev, 0).some((b: Bid) => b.level === level && b.strain === strain)
        ? makeBid(prev, 0, level, strain)
        : prev);
      return;
    }
    if (!transport) return;
    transport.sendBid(level, strain);
  }, [mode, transport]);

  const handleHumanPass = useCallback(() => {
    if (mode === 'solo') {
      setState((prev: GameState) => (canPass(prev, 0) ? pass(prev, 0) : prev));
      return;
    }
    if (!transport) return;
    transport.sendPass();
  }, [mode, transport]);

  const handleHumanCallCard = useCallback((card: Card) => {
    if (mode === 'solo') {
      setState((prev: GameState) => humanCallableCards(prev, 0).some((c: Card) => cardsEqual(c, card))
        ? callPartner(prev, 0, card)
        : prev);
      return;
    }
    if (!transport) return;
    transport.sendCallPartner(card);
  }, [mode, transport]);

  const handleHumanPlayCard = useCallback((card: Card) => {
    if (mode === 'solo') {
      setState((prev: GameState) => {
        if (computeAwaitingContinue(prev, pauseAfterTrick, resumedAt)) return prev;
        return humanLegalPlays(prev, 0).some((c: Card) => cardsEqual(c, card))
          ? playCard(prev, 0, card)
          : prev;
      });
      return;
    }
    if (!transport) return;
    transport.sendPlayCard(card);
  }, [mode, transport, pauseAfterTrick, resumedAt]);

  return {
    state,
    rules,
    showTutorial: mode === 'solo' ? showTutorial : false,
    setShowTutorial,
    pauseAfterTrick,
    awaitingContinue,
    handleNewHand,
    handleStartGame,
    handleSetRules,
    handleSetPauseAfterTrick,
    handleContinue,
    handleHumanBid,
    handleHumanPass,
    handleHumanCallCard,
    handleHumanPlayCard,
    legalBids: humanLegalBids(state, seat),
    legalPlays: awaitingContinue ? [] : humanLegalPlays(state, seat),
    availableCallCards: humanCallableCards(state, seat),
    canPass: canPass(state, state.currentPlayer ?? seat),
    statusText: getGameStatusText(state),
    isHumanTurn: state.currentPlayer === seat,
    mode,
    seat,
    connectionError,
    canStartGame: mode === 'host' && waitForPeersRef.current && state.phase === 'DEALING',
  };
}