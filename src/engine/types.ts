/** Core types for Singaporean Floating Bridge */

export type Suit = 'Spades' | 'Hearts' | 'Clubs' | 'Diamonds';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type PlayerIndex = 0 | 1 | 2 | 3; // 0=South, 1=West, 2=North, 3=East
export type Phase = 'DEALING' | 'AUCTION' | 'PARTNER_CALL' | 'TRICK_PLAY' | 'HAND_RESULT';

export const PLAYER_NAMES: Record<PlayerIndex, string> = {
  0: 'South',
  1: 'West',
  2: 'North',
  3: 'East',
};

export const SUIT_ORDER: Record<Suit, number> = {
  Diamonds: 0,
  Clubs: 1,
  Hearts: 2,
  Spades: 3,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  Spades: '♠',
  Hearts: '♥',
  Clubs: '♣',
  Diamonds: '♦',
};

export const SUIT_COLORS: Record<Suit, 'red' | 'black'> = {
  Spades: 'black',
  Hearts: 'red',
  Clubs: 'black',
  Diamonds: 'red',
};

export const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface Bid {
  player: PlayerIndex;
  tricks: number; // 1-13
  suit: Suit;
}

export interface Trick {
  cards: Array<{ player: PlayerIndex; card: Card }>;
  leader: PlayerIndex;
  winner: PlayerIndex | null;
  ledSuit: Suit | null;
  trumpSuit: Suit;
}

export interface Partnership {
  declarer: PlayerIndex;
  partner: PlayerIndex;
  defenders: [PlayerIndex, PlayerIndex];
}

export interface GameState {
  phase: Phase;
  dealer: PlayerIndex;
  hands: Card[][];
  auction: {
    bids: Bid[];
    currentBid: Bid | null;
    activePlayers: Set<PlayerIndex>;
    passes: Set<PlayerIndex>;
    declarer: PlayerIndex | null;
  };
  contract: {
    tricksRequired: number;
    trumpSuit: Suit;
  } | null;
  calledCard: Card | null;
  partnerships: Partnership | null;
  tricks: {
    completed: Trick[];
    current: Trick | null;
  };
  result: {
    tricksWonByDeclarer: number;
    contractMade: boolean | null;
  } | null;
  currentPlayer: PlayerIndex | null;
}

export function createCard(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function compareCards(a: Card, b: Card, trumpSuit: Suit): number {
  const aIsTrump = a.suit === trumpSuit;
  const bIsTrump = b.suit === trumpSuit;

  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;
  return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}

export function compareBids(a: Bid, b: Bid): number {
  if (a.tricks !== b.tricks) return a.tricks - b.tricks;
  return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
}

export function isHigherBid(current: Bid | null, candidate: Bid): boolean {
  if (!current) return true;
  return compareBids(candidate, current) > 0;
}

export function createDeck(): Card[] {
  const suits: Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[]): Card[][] {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 52; i++) {
    hands[i % 4].push(deck[i]);
  }
  return hands;
}

export function sortHand(hand: Card[]): Card[] {
  const suitPriority: Record<Suit, number> = { Spades: 0, Hearts: 1, Clubs: 2, Diamonds: 3 };
  return [...hand].sort((a, b) => {
    const suitDiff = suitPriority[a.suit] - suitPriority[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
  });
}

export function getLegalBids(currentBid: Bid | null, player: PlayerIndex, isFirstBid: boolean): Bid[] {
  if (isFirstBid && player === 0) {
    // First player must open - generate all possible bids
    const bids: Bid[] = [];
    for (let tricks = 1; tricks <= 13; tricks++) {
      for (const suit of ['Spades', 'Hearts', 'Clubs', 'Diamonds'] as Suit[]) {
        bids.push({ player, tricks, suit });
      }
    }
    return bids;
  }

  if (!currentBid) return [];

  const bids: Bid[] = [];
  for (let tricks = currentBid.tricks; tricks <= 13; tricks++) {
    const startSuit = tricks === currentBid.tricks ? SUIT_ORDER[currentBid.suit] + 1 : 0;
    for (let s = startSuit; s < 4; s++) {
      const suit = ['Diamonds', 'Clubs', 'Hearts', 'Spades'][s] as Suit;
      bids.push({ player, tricks, suit });
    }
  }
  return bids;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function findCardInHand(hand: Card[], card: Card): number {
  return hand.findIndex(c => cardsEqual(c, card));
}

export function removeCardFromHand(hand: Card[], card: Card): Card[] {
  return hand.filter(c => !cardsEqual(c, card));
}