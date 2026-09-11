import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameTable, SoloCallWarning } from '../src/components/GameTable';
import type { GameState, PlayerIndex } from '../src/engine/types';
import { DEFAULT_RULES } from '../src/engine/types';
import {
  createInitialState, startAuction, makeBid, pass, callPartner, playCard,
} from '../src/engine/gameEngine';
import { makeAiDecision } from '../src/ai/aiPlayer';

function playWholeHand(hiddenPartner: boolean): GameState {
  let s = startAuction(createInitialState(0, { ...DEFAULT_RULES, hiddenPartner }));
  let guard = 0;
  while (s.phase !== 'HAND_RESULT' && guard++ < 200) {
    const p = s.currentPlayer as PlayerIndex;
    const d = makeAiDecision(s, p);
    if (d.action === 'bid') s = makeBid(s, p, d.bid!.level, d.bid!.strain);
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
    expect(html).toMatch(/Contract (MADE|FAILED)/);
    // One body row per trick.
    const rows = html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g) ?? [];
    expect(rows).toHaveLength(13);
    // Every auction call appears (bids show as N + suit symbol, passes as "pass").
    const passes = s.auction.log.filter(c => c.bid === null).length;
    expect((html.match(/<em>pass<\/em>/g) ?? []).length).toBe(passes);
    // Called card is starred exactly once.
    expect((html.match(/title="called card"/g) ?? []).length).toBe(1);
  });

  it('headlines South\'s result, not the declarer\'s', () => {
    const s = playWholeHand(false);
    const { declarer, partner } = s.partnerships!;
    const southOnDeclarerSide = declarer === 0 || partner === 0;
    const southWon = s.result!.contractMade === southOnDeclarerSide;
    const html = render(s);
    expect(html).toContain(southWon ? 'YOU WON' : 'YOU LOST');
    expect(html).not.toContain(southWon ? 'YOU LOST' : 'YOU WON');
    if (!southOnDeclarerSide) {
      // Defending South is told what their own side won, not only the declarer's count.
      const southSide = 13 - s.result!.tricksWonByDeclarer;
      expect(html).toContain(`Your side won: <strong>${southSide} /`);
    }
  });
});

describe('Wash display', () => {
  it('shows the wash count, the minimum and your points during the auction', () => {
    const html = render({ ...startAuction(createInitialState(0, DEFAULT_RULES)), washes: 2 });
    expect(html).toContain('Washed 2 deals.');
    expect(html).toMatch(/at least 4 points; yours has \d+\./);
  });

  it('says nothing about washing when the rule is off', () => {
    const html = render(startAuction(createInitialState(0, { ...DEFAULT_RULES, wash: false })));
    expect(html).not.toMatch(/yours has/);
  });
});

describe('Solo call display', () => {
  /** South wins the auction and calls a card from their own hand, then plays the hand out. */
  function southSolo(hiddenPartner: boolean, until: GameState['phase']): GameState {
    let s = startAuction(createInitialState(3, { ...DEFAULT_RULES, hiddenPartner })); // South opens
    s = makeBid(s, 0, 7, 'NoTrump');
    let guard = 0;
    while (s.phase !== until && guard++ < 200) {
      const p = s.currentPlayer as PlayerIndex;
      if (s.phase === 'PARTNER_CALL') { s = callPartner(s, 0, s.hands[0][0]); continue; }
      const d = makeAiDecision(s, p);
      if (d.action === 'pass') s = pass(s, p);
      else s = playCard(s, p, d.card!);
    }
    expect(s.phase).toBe(until);
    return s;
  }

  it('warning toast names the card and needs confirmation', () => {
    const noop = () => {};
    const card = { suit: 'Hearts' as const, rank: 'K' as const };
    const hidden = renderToStaticMarkup(<SoloCallWarning card={card} hiddenPartner={true} onConfirm={noop} onCancel={noop} />);
    expect(hidden).toContain('role="alertdialog"');
    expect(hidden).toContain('Play alone?');
    expect(hidden).toContain('Cancel');
    expect(hidden).toContain('Call it and play alone');
    expect(hidden).toContain('will not know that until you play');
    const open = renderToStaticMarkup(<SoloCallWarning card={card} hiddenPartner={false} onConfirm={noop} onCancel={noop} />);
    expect(open).toContain('know straight away');
  });

  it('tells the solo declarer they play alone, and the result shows no partner', () => {
    const play = southSolo(true, 'TRICK_PLAY');
    expect(render(play)).toContain('You play alone against all three.');
    const done = southSolo(true, 'HAND_RESULT');
    expect(render(done)).toContain('called their own');
    expect(render(done)).toContain('<strong>none</strong>');
  });
});

describe('Hidden partner display', () => {
  it('does not name the holder before the called card is played, unless you hold it', () => {
    let s = startAuction(createInitialState(0, { ...DEFAULT_RULES, hiddenPartner: true }));
    let guard = 0;
    while (s.phase !== 'TRICK_PLAY' && guard++ < 50) {
      const p = s.currentPlayer as PlayerIndex;
      const d = makeAiDecision(s, p);
      if (d.action === 'bid') s = makeBid(s, p, d.bid!.level, d.bid!.strain);
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
