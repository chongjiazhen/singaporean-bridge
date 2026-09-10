import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameTable } from '../src/components/GameTable';
import type { GameState, PlayerIndex } from '../src/engine/types';
import {
  createInitialState, startAuction, makeBid, pass, callPartner, playCard,
} from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';

function playWholeHand(hiddenPartner: boolean): GameState {
  let s = startAuction(createInitialState(0, { hiddenPartner }));
  let guard = 0;
  while (s.phase !== 'HAND_RESULT' && guard++ < 200) {
    const p = s.currentPlayer as PlayerIndex;
    const d = makeAiDecision(s, p);
    if (d.action === 'bid') s = makeBid(s, p, d.bid!.tricks, d.bid!.suit);
    else if (d.action === 'pass') s = pass(s, p);
    else if (d.action === 'call') s = callPartner(s, p, d.card!);
    else s = playCard(s, p, d.card!);
  }
  return s;
}

function render(state: GameState): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <GameTable
      state={state}
      rules={state.rules}
      humanHand={state.hands[0]}
      legalPlays={[]}
      availableCallCards={[]}
      legalBids={[]}
      canPass={false}
      statusText=""
      isHumanTurn={false}
      onBid={noop}
      onPass={noop}
      onCallCard={noop}
      onPlayCard={noop}
      onOpenTutorial={noop}
      onCloseTutorial={noop}
      onNewHand={noop}
      onSetRules={noop}
      showTutorial={false}
    />,
  );
}

describe('End-of-hand summary', () => {
  it('lists the full auction and all 13 tricks with winners', () => {
    const s = playWholeHand(false);
    expect(s.phase).toBe('HAND_RESULT');
    const html = render(s);
    expect(html).toMatch(/CONTRACT (MADE|FAILED)/);
    // One body row per trick.
    const rows = html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g) ?? [];
    expect(rows).toHaveLength(13);
    // Every auction call appears (bids show as N + suit symbol, passes as "pass").
    const passes = s.auction.log.filter(c => c.bid === null).length;
    expect((html.match(/<em>pass<\/em>/g) ?? []).length).toBe(passes);
    // Called card is starred exactly once.
    expect((html.match(/title="called card"/g) ?? []).length).toBe(1);
  });
});

describe('Hidden partner display', () => {
  it('does not name the holder before the called card is played, unless you hold it', () => {
    let s = startAuction(createInitialState(0, { hiddenPartner: true }));
    let guard = 0;
    while (s.phase !== 'TRICK_PLAY' && guard++ < 50) {
      const p = s.currentPlayer as PlayerIndex;
      const d = makeAiDecision(s, p);
      if (d.action === 'bid') s = makeBid(s, p, d.bid!.tricks, d.bid!.suit);
      else if (d.action === 'pass') s = pass(s, p);
      else s = callPartner(s, p, d.card!);
    }
    const html = render(s);
    const partner = s.partnerships!.partner;
    if (partner === 0) {
      expect(html).toContain('secret partner');
    } else {
      expect(html).toContain('holder hidden');
      expect(html).not.toMatch(/held by/);
      expect(html).toContain('Partner not yet revealed');
    }
  });
});
