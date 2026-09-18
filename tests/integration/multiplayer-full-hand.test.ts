import { describe, it, expect } from 'vitest';
import type { Transport, GameState, PlayerIndex } from '../../src/network/transport';
import { makeTransport, InMemoryBroker } from '../../src/network/transport';
import type { Card, Strain } from '../../src/engine/types';
import { getLegalPlays, canPass } from '../../src/engine/gameEngine';
import { getLegalBids } from '../../src/engine/types';
import { makeAiDecision } from '../../src/ai/aiPlayer';

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A scripted "human host" driver. Whenever the transport's turn lands on the
 * host seat it plays a legal move; every other seat is bot-filled by the
 * transport itself. This mirrors what the UI does for the human seat while the
 * host engine simulates the remaining three, so it exercises the full
 * host-authoritative path end to end.
 */
async function driveHostHand(hostSeat: PlayerIndex): Promise<{
  transport: Transport;
  last: GameState | null;
  phases: Set<string>;
}> {
  const broker = new InMemoryBroker();
  const transport = await makeTransport({ roomKey: 'full-hand-' + hostSeat, isHost: true, broker, hostSeat });

  const lastRef: { current: GameState | null } = { current: null };
  const phases = new Set<string>();
  transport.onGameState((state: GameState) => {
    lastRef.current = state;
    phases.add(state.phase);
  });

  const driveHostTurn = () => {
    const state = lastRef.current;
    if (!state || state.currentPlayer !== hostSeat) return;
    switch (state.phase) {
      case 'AUCTION': {
        const bids = getLegalBids(state.auction.currentBid, hostSeat);
        if (canPass(state, hostSeat) && bids.length === 0) {
          transport.sendPass(hostSeat);
        } else if (bids.length) {
          const top = bids[0];
          transport.sendBid(top.level, top.strain as Strain);
        } else {
          transport.sendPass(hostSeat);
        }
        break;
      }
      case 'PARTNER_CALL': {
        const decision = makeAiDecision(state, hostSeat);
        if (decision.action === 'call' && decision.card) {
          transport.sendCallPartner(decision.card as Card);
        }
        break;
      }
      case 'TRICK_PLAY': {
        const plays = getLegalPlays(state, hostSeat);
        if (plays.length) {
          transport.sendPlayCard(plays[0] as Card);
        }
        break;
      }
      default:
        break;
    }
  };

  // Let async init run (onGameState now delivers the current snapshot on
  // subscribe, so `lastRef` is populated even before the first tick).
  await tick();
  for (let i = 0; i < 500 && (!lastRef.current || lastRef.current.phase !== 'HAND_RESULT'); i++) {
    driveHostTurn();
    await tick();
  }
  await tick();
  await tick();

  return { transport, last: lastRef.current, phases };
}

describe('009 - full multiplayer hand (host-authoritative, human host + bot seats)', () => {
  // Every possible host seat, since the engine rotates by seating and the
  // acceptance criteria require the hand to complete regardless of who hosts.
  for (const hostSeat of [0, 1, 2, 3] as PlayerIndex[]) {
    it(`plays a complete hand from auction to HAND_RESULT when host is seat ${hostSeat}`, async () => {
      const { transport, last, phases } = await driveHostHand(hostSeat);

      // Auction -> partner call -> trick play -> hand result, all traversed.
      expect(phases.has('AUCTION')).toBe(true);
      expect(phases.has('PARTNER_CALL')).toBe(true);
      expect(phases.has('TRICK_PLAY')).toBe(true);

      // The hand actually finished: exactly 13 tricks were played and a result
      // (contract made / defeated, tricks won) was computed.
      expect(last).not.toBeNull();
      expect(last!.phase).toBe('HAND_RESULT');
      expect(last!.tricks.completed.length).toBe(13);
      expect(last!.result).toBeTruthy();
      expect(typeof last!.result!.tricksWonByDeclarer).toBe('number');
      expect(typeof last!.result!.contractMade).toBe('boolean');

      transport.destroy();
    });
  }
});
