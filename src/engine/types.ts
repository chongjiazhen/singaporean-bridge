/** Core types for Singaporean Floating Bridge */

export type Suit = 'Spades' | 'Hearts' | 'Clubs' | 'Diamonds';
/** What a bid names: a trump suit, or no trump. */
export type Strain = Suit | 'NoTrump';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type PlayerIndex = 0 | 1 | 2 | 3; // 0=South, 1=West, 2=North, 3=East
export type Phase = 'DEALING' | 'AUCTION' | 'PARTNER_CALL' | 'TRICK_PLAY' | 'HAND_RESULT';

export const SUITS: readonly Suit[] = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
/** Strains from highest to lowest bidding rank. */
export const STRAINS: readonly Strain[] = ['NoTrump', 'Spades', 'Hearts', 'Clubs', 'Diamonds'];
export const RANKS: readonly Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
export const PLAYERS: readonly PlayerIndex[] = [0, 1, 2, 3];

/** Bids use a book of six: level 1 commits the side to 7 tricks, level 7 to all 13. */
export const BOOK = 6;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 7;

export const PLAYER_NAMES: Record<PlayerIndex, string> = {
  0: 'South',
  1: 'West',
  2: 'North',
  3: 'East',
};

/** Bidding rank. Suits follow poker order (Spades > Hearts > Clubs > Diamonds); no trump is highest. */
export const STRAIN_ORDER: Record<Strain, number> = {
  Diamonds: 0,
  Clubs: 1,
  Hearts: 2,
  Spades: 3,
  NoTrump: 4,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  Spades: '♠',
  Hearts: '♥',
  Clubs: '♣',
  Diamonds: '♦',
};

export const STRAIN_SYMBOLS: Record<Strain, string> = { ...SUIT_SYMBOLS, NoTrump: 'NT' };

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
  /** 1-7. Tricks required = level + BOOK. */
  level: number;
  strain: Strain;
}

export interface Contract {
  level: number;
  strain: Strain;
  tricksRequired: number;
  /** null in a no-trump contract. */
  trumpSuit: Suit | null;
}

export interface Trick {
  cards: Array<{ player: PlayerIndex; card: Card }>;
  leader: PlayerIndex;
  winner: PlayerIndex | null;
  ledSuit: Suit | null;
  trumpSuit: Suit | null;
}

export interface Partnership {
  declarer: PlayerIndex;
  partner: PlayerIndex;
  defenders: [PlayerIndex, PlayerIndex];
}

/** Configurable variant rules (SPEC 27). Carried from hand to hand. */
export interface GameRules {
  /**
   * Hidden partner: after the call, only the holder of the called card knows
   * they are partner. Everyone else learns the partnership when that card is played.
   */
  hiddenPartner: boolean;
}

export const DEFAULT_RULES: GameRules = { hiddenPartner: true };

/** What one seat knows about another seat's side. */
export type SideKnowledge = 'self' | 'ally' | 'opponent' | 'unknown';

/** One auction action in table order. `bid` is null for a pass. */
export interface AuctionCall {
  player: PlayerIndex;
  bid: Bid | null;
}

export interface GameState {
  phase: Phase;
  rules: GameRules;
  dealer: PlayerIndex;
  hands: Card[][];
  auction: {
    bids: Bid[];
    /** Every bid and pass, in the order they happened. */
    log: AuctionCall[];
    currentBid: Bid | null;
    activePlayers: Set<PlayerIndex>;
    passes: Set<PlayerIndex>;
    declarer: PlayerIndex | null;
  };
  contract: Contract | null;
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

export function bidToString(bid: { level: number; strain: Strain }): string {
  return `${bid.level}${STRAIN_SYMBOLS[bid.strain]}`;
}

export function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= MIN_LEVEL && level <= MAX_LEVEL;
}

export function tricksForLevel(level: number): number {
  return level + BOOK;
}

export function trumpOf(strain: Strain): Suit | null {
  return strain === 'NoTrump' ? null : strain;
}

export function contractFor(bid: { level: number; strain: Strain }): Contract {
  return {
    level: bid.level,
    strain: bid.strain,
    tricksRequired: tricksForLevel(bid.level),
    trumpSuit: trumpOf(bid.strain),
  };
}

export function compareBids(a: Bid, b: Bid): number {
  if (a.level !== b.level) return a.level - b.level;
  return STRAIN_ORDER[a.strain] - STRAIN_ORDER[b.strain];
}

export function isHigherBid(current: Bid | null, candidate: Bid): boolean {
  if (!current) return true;
  return compareBids(candidate, current) > 0;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
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

/**
 * Every bid `player` may make now. With no current bid every bid is legal
 * (the opener must bid, whoever they are); otherwise only strictly higher bids.
 */
export function getLegalBids(currentBid: Bid | null, player: PlayerIndex): Bid[] {
  const bids: Bid[] = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    for (const strain of STRAINS) {
      const bid = { player, level, strain };
      if (isHigherBid(currentBid, bid)) bids.push(bid);
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
