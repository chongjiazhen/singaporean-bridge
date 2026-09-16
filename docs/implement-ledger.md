# Multiplayer Implement Ledger

Branch: feature/multiplayer
Spec: spec/multiplayer-spec.md
Plan: docs/plans/2025-01-01-multiplayer.md
Serial: dispatch implementer -> verify acceptance myself -> commit -> next.

## Task 1: protocol.ts — done. Commit `902af82`
Acceptance: `vitest run tests/protocol.test.ts` PASS (22) · `tsc --noEmit` clean.
Notes: vitest anchors at tests/ root; tests live at tests/<name>.test.ts, import `../src/network/<name>`.

## Task 2: signaling.ts — done. Commit `915dd11`
Acceptance: `vitest run tests/signaling.test.ts` PASS (13) · `tsc --noEmit` clean.
Notes: Fixed encodeRandomKeys loop-bound (roomKeyLength honored).

## Task 3: peer.ts — done. Commit `7686db1`
Acceptance: `vitest run tests/peer.test.ts` PASS (13) · `tsc --noEmit` clean.
Exports: SEASTORAGE_PREFIX, seatStorageKey, rememberSeat, readSeat, RECONNECT_WINDOW_MS, ReclaimMap, assignSeat. readSeat guards JSON.parse.

## Task 4: transport.ts — done. Commit `47e44db`
Acceptance: `vitest run tests/transport.test.ts` PASS (10) · `tsc --noEmit` clean · full `vitest run` all 121 green.
Notes: InMemoryBroker placeholder + TransportBroker interface + assignSeats() (arrival-order, lexicographic tie). Host runs authoritative engine (makeBid/callPartner/playCard), broadcasts GAME_STATE, ERROR on rejection. Peer renders canonicalized snapshots + sends commands. Subagent failed twice on spec; wrote inline.

## Task 4: transport.ts — done + reviewed (approved by fresh reviewer, no game-logic leak). Final commit `47e44db`.

## Task 5: useGame — pending
Acceptance: `vitest run tests/hooks/useGame.test.ts` PASS; `tsc --noEmit` clean

## Task 6: App.tsx + GameTable.tsx — pending
Acceptance: `vitest run tests/components/GameTable.test.ts` PASS; `tsc --noEmit` clean; `npm run build` succeeds

## Final verification
`vitest run` (all green) · `tsc --noEmit` (clean) · `npm run build` (succeeds) · `oxlint src tests` (clean)
