/** Game Engine - Pure state transitions for Singaporean Floating Bridge */

import type {
  GameState, PlayerIndex, Card, Bid, Trick, Partnership,
  Suit
} from './types';
import {
  createDeck, shuffleDeck, dealCards, sortHand,
  isHigherBid, isValidTrickTarget,
  findCardInHand, removeCardFromHand,
  PLAYER_NAMES, SUIT_SYMBOLS, PLAYERS
} from './types';
import { compareCardsInTrick } from './trickEvaluator';

const toPlayerIndex = (n: number): PlayerIndex => n as PlayerIndex;

export function createInitialState(dealer: PlayerIndex = 0): GameState {
  const deck = shuffleDeck(createDeck());
  return createStateFromHands(dealCards(deck), dealer);
}

/** Build a fresh DEALING state from explicit hands. Used by tests to pin fixtures. */
export function createStateFromHands(hands: Card[][], dealer: PlayerIndex = 0): GameState {
  return {
    phase: 'DEALING',
    dealer,
    hands: hands.map(sortHand),
    auction: {
      bids: [],
      log: [],
      currentBid: null,
      activePlayers: new Set([0, 1, 2, 3]),
      passes: new Set(),
      declarer: null,
    },
    contract: null,
    calledCard: null,
    partnerships: null,
    tricks: {
      completed: [],
      current: null,
    },
    result: null,
    currentPlayer: dealer,
  };
}

export function startAuction(state: GameState): GameState {
  const firstBidder = toPlayerIndex((state.dealer + 1) % 4);
  return {
    ...state,
    phase: 'AUCTION',
    currentPlayer: firstBidder,
    auction: {
      ...state.auction,
      activePlayers: new Set([0, 1, 2, 3]),
      passes: new Set(),
    },
  };
}

export function makeBid(state: GameState, player: PlayerIndex, tricks: number, suit: Suit): GameState {
  if (state.phase !== 'AUCTION') throw new Error('Not in auction phase');
  if (state.currentPlayer !== player) throw new Error('Not your turn to bid');
  if (!state.auction.activePlayers.has(player)) throw new Error('Player has passed');
  if (!isValidTrickTarget(tricks)) throw new Error('Bid must be between 1 and 13 tricks');

  const bid: Bid = { player, tricks, suit };
  if (!isHigherBid(state.auction.currentBid, bid)) throw new Error('Bid must be higher than current bid');

  return {
    ...state,
    auction: {
      ...state.auction,
      bids: [...state.auction.bids, bid],
      log: [...state.auction.log, { player, bid }],
      currentBid: bid,
    },
    currentPlayer: getNextActivePlayer(state, player),
  };
}

export function pass(state: GameState, player: PlayerIndex): GameState {
  if (state.phase !== 'AUCTION') throw new Error('Not in auction phase');
  if (state.currentPlayer !== player) throw new Error('Not your turn');
  if (!state.auction.activePlayers.has(player)) throw new Error('Already passed');

  const isFirstBid = state.auction.bids.length === 0;
  if (isFirstBid && player === getFirstBidder(state)) {
    throw new Error('First player cannot pass');
  }

  const newPasses = new Set(state.auction.passes);
  newPasses.add(player);
  const newActive = new Set(state.auction.activePlayers);
  newActive.delete(player);

  const updatedAuction = {
    ...state.auction,
    activePlayers: newActive,
    passes: newPasses,
    log: [...state.auction.log, { player, bid: null }],
  };

  if (newActive.size === 1) {
    // Auction ends - one active bidder remains
    const declarer = Array.from(newActive)[0] as PlayerIndex;
    const finalBid = state.auction.currentBid!;
    return {
      ...state,
      phase: 'PARTNER_CALL',
      auction: { ...updatedAuction, declarer },
      currentPlayer: declarer,
      contract: {
        tricksRequired: finalBid.tricks,
        trumpSuit: finalBid.suit,
      },
    };
  } else {
    const nextPlayer = getNextActivePlayer({ ...state, auction: updatedAuction }, player);
    return {
      ...state,
      auction: updatedAuction,
      currentPlayer: nextPlayer,
    };
  }
}

/** The player who must open the auction: dealer's left. */
export function getFirstBidder(state: GameState): PlayerIndex {
  return toPlayerIndex((state.dealer + 1) % 4);
}

/** True when `player` may pass right now (an opening bid exists, or they are not the opener). */
export function canPass(state: GameState, player: PlayerIndex): boolean {
  if (state.phase !== 'AUCTION' || state.currentPlayer !== player) return false;
  if (!state.auction.activePlayers.has(player)) return false;
  return !(state.auction.bids.length === 0 && player === getFirstBidder(state));
}

function getNextActivePlayer(state: GameState, current: PlayerIndex): PlayerIndex {
  let next = toPlayerIndex((current + 1) % 4);
  for (let i = 0; i < 4; i++) {
    if (state.auction.activePlayers.has(next)) return next;
    next = toPlayerIndex((next + 1) % 4);
  }
  return current; // Should not happen if activePlayers is not empty
}

export function callPartner(state: GameState, declarer: PlayerIndex, calledCard: Card): GameState {
  if (state.phase !== 'PARTNER_CALL') throw new Error('Not in partner call phase');
  if (state.auction.declarer !== declarer) throw new Error('Not the declarer');

  // Check called card is not in declarer's hand
  if (findCardInHand(state.hands[declarer], calledCard) !== -1) {
    throw new Error('Cannot call a card in your own hand');
  }

  // Find who has the called card
  const partner = PLAYERS.find(p => findCardInHand(state.hands[p], calledCard) !== -1);
  if (partner === undefined) throw new Error('Called card not found in any hand');
  if (partner === declarer) throw new Error('Cannot call your own card');

  const otherPlayers = PLAYERS.filter(p => p !== declarer && p !== partner);
  const defenders: [PlayerIndex, PlayerIndex] = [otherPlayers[0], otherPlayers[1]];

  const partnerships: Partnership = {
    declarer,
    partner,
    defenders,
  };

  const firstLeader = toPlayerIndex((declarer + 1) % 4); // Declarer's left

  const initialTrick: Trick = {
    cards: [],
    leader: firstLeader,
    winner: null,
    ledSuit: null,
    trumpSuit: state.contract!.trumpSuit,
  };

  return {
    ...state,
    phase: 'TRICK_PLAY',
    calledCard,
    partnerships,
    tricks: {
      ...state.tricks,
      current: initialTrick,
    },
    currentPlayer: firstLeader,
  };
}

export function playCard(state: GameState, player: PlayerIndex, card: Card): GameState {
  if (state.phase !== 'TRICK_PLAY') throw new Error('Not in trick play phase');
  if (state.currentPlayer !== player) throw new Error('Not your turn');

  const currentTrick = state.tricks.current!;
  const hand = state.hands[player];

  // Check card is in hand
  const cardIndex = findCardInHand(hand, card);
  if (cardIndex === -1) throw new Error('Card not in hand');

  // Check follow suit rule
  if (currentTrick.ledSuit && hand.some(c => c.suit === currentTrick.ledSuit)) {
    if (card.suit !== currentTrick.ledSuit) {
      throw new Error('Must follow suit');
    }
  }

  // Play the card
  const newHand = removeCardFromHand(hand, card);
  const newHands = [...state.hands];
  newHands[player] = newHand;

  const newTrickCards = [...currentTrick.cards, { player, card }];
  let newLedSuit = currentTrick.ledSuit;
  if (newTrickCards.length === 1) {
    newLedSuit = card.suit;
  }

  // Determine current winner of the trick
  let newWinner: PlayerIndex = newTrickCards[0].player;
  let winningCard = newTrickCards[0].card;

  for (let i = 1; i < newTrickCards.length; i++) {
    const play = newTrickCards[i];
    if (compareCardsInTrick(play.card, winningCard, newLedSuit!, currentTrick.trumpSuit) > 0) {
      newWinner = play.player;
      winningCard = play.card;
    }
  }

  const updatedTrick: Trick = {
    ...currentTrick,
    cards: newTrickCards,
    ledSuit: newLedSuit,
    winner: newWinner,
  };

  let nextPhase: GameState['phase'] = state.phase;
  let nextTricks: GameState['tricks'] = {
    completed: state.tricks.completed,
    current: updatedTrick,
  };
  let nextCurrentPlayer: PlayerIndex | null = toPlayerIndex((player + 1) % 4);
  let nextResult = state.result;

  if (newTrickCards.length === 4) {
    // Trick complete
    const completedTricks = [...state.tricks.completed, updatedTrick];
    const tricksWonByDeclarer = countTricksWon(completedTricks, state.partnerships!);

    if (completedTricks.length === 13) {
      // Hand complete
      const contractMade = tricksWonByDeclarer >= state.contract!.tricksRequired;
      nextPhase = 'HAND_RESULT';
      nextResult = { tricksWonByDeclarer, contractMade };
      nextCurrentPlayer = null;
      nextTricks = { completed: completedTricks, current: null };
    } else {
      // Next trick
      const nextLeader = updatedTrick.winner!;
      nextTricks = {
        completed: completedTricks,
        current: {
          cards: [],
          leader: nextLeader,
          winner: null,
          ledSuit: null,
          trumpSuit: state.contract!.trumpSuit,
        },
      };
      nextCurrentPlayer = nextLeader;
    }
  }

  return {
    ...state,
    hands: newHands,
    phase: nextPhase,
    tricks: nextTricks,
    currentPlayer: nextCurrentPlayer,
    result: nextResult,
  };
}

/** Tricks won so far by the declarer's side. */
export function countTricksWon(completed: Trick[], partnerships: Partnership): number {
  return completed.filter(t => t.winner === partnerships.declarer || t.winner === partnerships.partner).length;
}

export function isContractMade(state: GameState): boolean | null {
  if (!state.partnerships || !state.contract || state.tricks.completed.length < 13) return null;
  return countTricksWon(state.tricks.completed, state.partnerships) >= state.contract.tricksRequired;
}

export function startNextHand(state: GameState): GameState {
  const nextDealer = toPlayerIndex((state.dealer + 1) % 4);
  return createInitialState(nextDealer);
}

export function getLegalPlays(state: GameState, player: PlayerIndex): Card[] {
  if (state.phase !== 'TRICK_PLAY') return [];
  const hand = state.hands[player];
  const currentTrick = state.tricks.current;
  if (!currentTrick) return [];

  if (!currentTrick.ledSuit) return hand; // Leading - can play any card

  const hasLedSuit = hand.some(c => c.suit === currentTrick.ledSuit);
  if (hasLedSuit) {
    return hand.filter(c => c.suit === currentTrick.ledSuit);
  }
  return hand; // Can play any card when void in led suit
}

export function getGameStatusText(state: GameState): string {
  const currentPlayer = state.currentPlayer;
  switch (state.phase) {
    case 'DEALING':
      return 'Dealing cards...';
    case 'AUCTION':
      if (state.auction.currentBid) {
        return `${PLAYER_NAMES[currentPlayer ?? 0]} to bid. Current: ${state.auction.currentBid.tricks} ${SUIT_SYMBOLS[state.auction.currentBid.suit]}`;
      }
      return `${PLAYER_NAMES[currentPlayer ?? 0]} to open the bidding`;
    case 'PARTNER_CALL':
      return state.auction.declarer === 0
        ? 'You won the auction. Choose a card you do not hold to call your partner.'
        : `${PLAYER_NAMES[state.auction.declarer!]} won the auction and is choosing a card to call a partner.`;
    case 'TRICK_PLAY':
      const trickNum = state.tricks.completed.length + 1;
      const leader = PLAYER_NAMES[state.tricks.current!.leader];
      return `Trick ${trickNum}/13. ${leader} led. ${PLAYER_NAMES[currentPlayer ?? 0]} to play.`;
    case 'HAND_RESULT':
      return state.result!.contractMade
        ? `Contract MADE: ${state.result!.tricksWonByDeclarer}/${state.contract!.tricksRequired} tricks`
        : `Contract FAILED: ${state.result!.tricksWonByDeclarer}/${state.contract!.tricksRequired} tricks`;
  }
}