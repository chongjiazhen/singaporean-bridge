# HANDOFF — singaporean-bridge-table

## What changed (this session, the "two separate tables" sync fix)

The 2-human multiplayer flow was showing **two different tables** (different
deals) and stalling. Root cause: in host mode `src/hooks/useGame.ts` ran a
parallel **local** engine (`startAuction(createInitialState(...))`) that dealt
its own random hand, while `src/network/transport.ts` ran the **authoritative**
engine. The two never met, so the host tab and the peer tab each rendered a
different deal and the auction never converged.

Fix (commit `48894e2`): the UI now consumes the **transport's** authoritative
`GAME_STATE` snapshots in **both host and peer modes**; the local `state` is
only a pre-transport placeholder in those modes.

Files changed:
- `src/hooks/useGame.ts` — host/peer use `createInitialState` (no local
  `startAuction`); transport snapshots overwrite it. Rules preview only in solo.
  `handleNewHand` routes through `transport.sendNewHand()` in host mode.
- `src/network/transport.ts` — host-only `sendNewHand()` deals on the
  authoritative engine and broadcasts (all peers see the same next deal). A
  newly-seated peer (late join **or refresh**) immediately receives the current
  snapshot. The peer tracks its latest snapshot so a late/refreshed subscriber
  recovers the same hand.
- `src/App.tsx` — top-level `GameErrorBoundary` so a bad snapshot render
  recovers to a reloadable screen instead of blanking the page.
- `tests/multiplayer-sync.test.tsx` — NEW. 4 cases with an in-process coupled
  host+peer transport room: (1) host and peer get the SAME deal; (2) host + peer
  bids land in the same shared auction on both sides (identical logs); (3) empty
  seats are bot-filled to HAND_RESULT and both sides match (13 tricks, same
  result); (4) a refresh re-subscriber recovers the SAME deal, not a new one.
- `docs/` — rebuilt bundle (GitHub Pages).

## Verification (all green at `48894e2`)
- `npx tsc -b` — exit 0
- `npx vitest run` — 161 passed (157 original + 4 new)
- `npm run build` — exit 0, docs/ bundle emitted
- Pushed to `origin/feature/multiplayer` (`efee650..48894e2`)

## Not yet done (needs the operator, at the desk)
1. **Re-test the 2-human flow** on the live site after the Pages deploy:
   - Tab A: "Create Game".
   - Tab B: "Join with Link" with A's link (should seat, not error).
   - **Confirm both tabs show the SAME deal** (the core sync fix).
   - Confirm empty seats fill with bots and the hand progresses to a result on
     both tabs.
   - Refresh one tab mid-hand and confirm it recovers the SAME deal, not a new
     one.
2. **Browser E2E still not runnable headlessly** on this box (CDP connect fails
   against the sandboxed `npm run dev` process). The transport-level test above
   covers the sync logic without a browser; a true click-through remains manual.

## Environment / how to run
- Windows native; git-bash. `python3` is a broken shim (9009) — use `py -3`.
- Acceptance: `npx tsc -b && npx vitest run && npm run build`.
- Deploy: `npm run build` (emits `docs/`) + `git push origin feature/multiplayer`
  (GitHub Pages serves `docs/`).
