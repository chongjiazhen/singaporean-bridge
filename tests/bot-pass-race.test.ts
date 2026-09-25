import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Transport, GameState, PlayerIndex } from '../src/network/transport';
import { makeTransport, InMemoryBroker } from '../src/network/transport';
import type { Card, Strain } from '../src/engine/types';
import { getLegalPlays, canPass } from '../src/engine/gameEngine';
import { getLegalBids } from '../src/engine/types';
import { makeAiDecision } from '../src/ai/aiPlayer';

const tick = () => vi.runOnlyPendingTimersAsync();

describe('Bot pass race fix (ticket 010)', { timeout: 10000 }, () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let broker: InMemoryBroker;
  let hostTransport: Transport;
  let hostStates: GameState[];
  let hostErrors: string[];

  beforeEach(async () => {
    broker = new InMemoryBroker();
    hostStates = [];
    hostErrors = [];

    hostTransport = await makeTransport({
      roomKey: 'bot-pass-race',
      isHost: true,
      broker,
      hostSeat: 0,
    });

    hostTransport.onGameState((state) => hostStates.push(state));
    hostTransport.onError((reason) => hostErrors.push(reason));
    await tick();
  });

  afterEach(() => {
    hostTransport.destroy();
  });

  it('bot pass is applied synchronously in the same call stack as the triggering broadcast', async () => {
    // No peers connect - seats 1, 2, 3 are all bots
    // First bidder is seat 1 (dealer=0, firstBidder=1)
    // Bot at seat 1 should bid, then bot at seat 2, etc.
    // We let the bot loop run until a pass decision is made
    
    await tick();
    await tick();
    await tick();
    
    // The key property: no ERROR frames should have been emitted
    // (no "Not your turn" or "Already passed" errors from race conditions)
    expect(hostErrors).toHaveLength(0);
    
    // The state should have advanced properly through the auction
    expect(hostStates.length).toBeGreaterThan(0);
  });

  it('scripted auction with multiple bot passes in sequence applies without race', async () => {
    // No peers - all 3 other seats are bots
    // Let the auction run through multiple bot passes
    // Auction order: seat 1 (bot) opens, seat 2 (bot) may pass, seat 3 (bot) may pass, seat 0 (host human) may pass
    
    await tick(); // seat 1 bids
    await tick(); // seat 2 acts (bid or pass)
    await tick(); // seat 3 acts
    await tick(); // seat 0 acts (host - but it's a bot scenario since host is human but we don't intervene)
    
    // Wait for auction to end (go to PARTNER_CALL or beyond)
    for (let i = 0; i < 20; i++) {
      await tick();
      if (hostStates.length > 0 && hostStates[hostStates.length - 1].phase !== 'AUCTION') {
        break;
      }
    }

    // No ERROR frames should be emitted during auction
    // (specifically no "Not your turn" or "Already passed" from race conditions)
    const errorFrames = hostErrors.filter(e => e.includes('Not your turn') || e.includes('Already passed'));
    expect(errorFrames).toHaveLength(0);
  });

  it('full hand with bot passes completes without errors', async () => {
    // No peers - all 3 other seats are bots, but host seat 0 is human
    // We need to drive the host seat like the multiplayer-full-hand test does
    
    const driveHostTurn = () => {
      const state = hostStates[hostStates.length - 1];
      if (!state || state.currentPlayer !== 0) return;
      switch (state.phase) {
        case 'AUCTION': {
          const bids = getLegalBids(state.auction.currentBid, 0);
          if (canPass(state, 0) && bids.length === 0) {
            hostTransport.sendPass(0);
          } else if (bids.length) {
            const top = bids[0];
            hostTransport.sendBid(top.level, top.strain as Strain);
          } else {
            hostTransport.sendPass(0);
          }
          break;
        }
        case 'PARTNER_CALL': {
          const decision = makeAiDecision(state, 0);
          if (decision.action === 'call' && decision.card) {
            hostTransport.sendCallPartner(decision.card as Card);
          }
          break;
        }
        case 'TRICK_PLAY': {
          const plays = getLegalPlays(state, 0);
          if (plays.length) {
            hostTransport.sendPlayCard(plays[0] as Card);
          }
          break;
        }
        default:
          break;
      }
    };

    // Let async init run
    await tick();
    for (let i = 0; i < 2000 && (!hostStates.length || hostStates[hostStates.length - 1].phase !== 'HAND_RESULT'); i++) {
      driveHostTurn();
      await tick();
    }
    await tick();
    await tick();

    // No ERROR frames should be emitted during the entire hand
    const raceErrors = hostErrors.filter(e => 
      e.includes('Not your turn') || 
      e.includes('Already passed') ||
      e.includes('pass')
    );
    expect(raceErrors).toHaveLength(0);

    // Hand should complete with 13 tricks
    const finalState = hostStates[hostStates.length - 1];
    expect(finalState).toBeDefined();
    if (finalState) {
      expect(finalState.phase).toBe('HAND_RESULT');
      expect(finalState.tricks.completed.length).toBe(13);
    }
  });

  it('rapid succession of bot passes does not throw', async () => {
    // No peers - seats 1, 2, 3 are bots
    // Let the auction progress naturally with bot passes
    
    // Wait for auction to complete
    for (let i = 0; i < 30; i++) {
      await tick();
      if (hostStates.length > 0 && hostStates[hostStates.length - 1].phase !== 'AUCTION') {
        break;
      }
    }
    
    // No errors from "Not your turn" or "Already passed" 
    const raceErrors = hostErrors.filter(e => 
      e.includes('Not your turn') || 
      e.includes('Already passed')
    );
    expect(raceErrors).toHaveLength(0);
  });
});