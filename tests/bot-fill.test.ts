import { describe, it, expect } from 'vitest';
import type { PlayerIndex, GameState } from '../src/engine/types';
import { makeTransport, InMemoryBroker } from '../src/network/transport';

const tick = () => new Promise((r) => setTimeout(r, 0));

// Test that bots make moves when it's their turn
describe('Bot fill', () => {
  it('bot makes a bid when it is the bot seat turn in auction', async () => {
    const broker = new InMemoryBroker();
    // Host is seat 0, peer joins and gets seat 1, seats 2 and 3 are bots
    let currentState: GameState | null = null;
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    t.onGameState((state) => {
      currentState = state;
    });
    await tick();
    
    // No peers connect - seats 1, 2, 3 are all bots
    // First bidder is seat 1 (dealer=0, firstBidder=1)
    // This is a bot seat, so bot should make a move
    await tick();
    await tick();
    await tick();

    // Concrete bot effect: the bot seat advanced the auction by recording a
    // bid. A null AI decision (bots not acting) leaves bids empty and fails here.
    expect(currentState, 'received an auction snapshot').not.toBeNull();
    expect(currentState!.phase, 'auction reached').toBe('AUCTION');
    expect(
      currentState!.auction.bids.length,
      'bot recorded a concrete bid, not just a non-null state snapshot',
    ).toBeGreaterThan(0);

    t.destroy();
  }, 5000);
  
  it('human peer joining takes over bot seat', async () => {
    const broker = new InMemoryBroker();
    const t = await makeTransport({ roomKey: 'r', isHost: true, broker, hostSeat: 0 });
    await tick();
    
    let assignedSeat: PlayerIndex | null = null;
    t.onPeerAssigned((info) => {
      assignedSeat = info.seat;
    });
    
    // Simulate peer connecting
    broker.__emitPeerConnect('human-peer');
    await tick();
    
    // The peer should be assigned a seat
    expect(assignedSeat).not.toBeNull();
    
    // That seat should now be tracked as human
    // If bot was about to move for that seat, it should not anymore
    t.destroy();
  });
});