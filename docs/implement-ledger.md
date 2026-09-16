# Multiplayer Implement Ledger

Branch: feature/multiplayer
Spec: spec/multiplayer-spec.md
Plan: docs/plans/2025-01-01-multiplayer.md
Serial execution: dispatch implementer -> verify acceptance myself -> commit -> dispatch next.

## Task 1: protocol.ts
Status: done. Commit `902af82`.
Acceptance: `npx vitest run tests/protocol.test.ts` PASS (22 tests); `npx tsc --noEmit` clean.
Notes: vitest anchors at tests/ root (not subdirs) so tests live at tests/<name>.test.ts with import `../src/network/<name>`. Reviewer approved with P2: `deserializeFrame` returned non-Frame when data absent -> fixed with `!('data' in parsed)` guard, committed in same hash.

## Task 2: signaling.ts
Status: done. Commit `915dd11`.
Acceptance: `npx vitest run tests/signaling.test.ts` PASS (13 tests); `npx tsc --noEmit` clean.
Notes: Fixed loop-bound bug: `encodeRandomKeys` capped output at 24 regardless of roomKeyLength (48 -> 24). Fixed bound + added length-honor test. `crypto.getRandomValues(Uint8Array)` works in Node.

## Task 3: peer.ts
Status: done. Commit `7686db1`.
Acceptance: `npx vitest run tests/peer.test.ts` PASS (13 tests); `npx tsc --noEmit` clean.
Notes: Exports: SEASTORAGE_PREFIX, seatStorageKey, rememberSeat, readSeat, RECONNECT_WINDOW_MS, ReclaimMap, assignSeat. readSeat guards JSON.parse (returns null). No game logic.

## Task 4: transport.ts
Status: pending
Acceptance: `npx vitest run tests/transport.test.ts` PASS; `npx tsc --noEmit` clean

## Task 5: useGame
Status: pending
Acceptance: `npx vitest run tests/hooks/useGame.test.ts` PASS; `npx tsc --noEmit` clean

## Task 6: App.tsx + GameTable.tsx
Status: pending
Acceptance: `npx vitest run tests/components/GameTable.test.ts` PASS; `npx tsc --noEmit` clean; `npm run build` succeeds

## Final verification
Run: `npx vitest run` (all green) · `npx tsc --noEmit` (clean) · `npm run build` (succeeds) · `npx oxlint src tests` (clean)
