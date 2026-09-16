# Singaporean Bridge Multiplayer Implementation Plan

Spec: spec/multiplayer-spec.md
Goal: Add 4-player browser P2P host-authoritative invite-link multiplayer with zero persistent game backend.

## Global Constraints

- 4-player max (host seat + up to 3 human peers). No seat beyond 4.
- `seat = (hostSeat + arrivalPosition) % 4`; arrivalPosition = 1/2/3 for first/second/third joined peer. Fixed at connect, never re-derived from stale connection.
- Frame envelope: `{ type: 'BID' | 'CALL_PARTNER' | 'PLAY_CARD' | 'GAME_STATE' | 'PLAYER_ASSIGNMENT' | 'ERROR', data: <payload> }`.
- Inbound (player → host) command frames only: `BID { level: number(1-7), strain: Strain }` via `engine.makeBid(state, seat, level, strain)`; `CALL_PARTNER { card: Card }` via `engine.callPartner(state, seat, card)`; `PLAY_CARD { card: Card }` via `engine.playCard(state, seat, card)`.
- No outbound `pass` frame (host-driven). No sequence numbers (ordering is broker-provided per channel).
- `GAME_STATE` = full `GameState` snapshot, source of truth players render from.
- Bot-filled seats (`seat -> null`) simulated in host engine, no network identity, never a peer.
- `sessionStorage[roomKey] = seatIndex` on connect; session-scoped.
- Invite = `location.href + "#join/<roomKey>"`; fragment never sent to HTTP.
- `roomKey` = invite secret; unguessable; broker isolates by it.
- Engine files (`types.ts`, `gameEngine.ts`, `trickEvaluator.ts`, `ai/aiPlayer.ts`) are **unchanged**.
- `network/` deals only in transport and frames; no game logic leaks in.

## Design decisions (resolved from Open questions)

1. **Broker**: abstracted behind a single `PeerJSClass`-style transport interface in `transport.ts`. The `signaling.ts`/`peer.ts` modules target the create-room/return-key + per-player ordered-channel contract. A concrete broker is injected, not hardcoded — this keeps the repo static (no server, no npm broker SDK committed) and lets the operator wire a managed service at the seam.
2. **Reconnect window**: 45 seconds per hand (between a hand's final frame and hand reset / next connect), configurable constant.
3. **Bot-fill policy**: reuse existing `aiPlayer.ts` `makeAiDecision` for bot seats (spec option).
4. **Seat-assignment edge**: serialize the first two joins by broker arrival timestamp; on tie, lower `connectionId` wins. Deterministic.
5. **GAME_STATE diffability**: canonicalize snapshot via `JSON.parse(JSON.stringify(...))` in `protocol.ts`; `Set`/`null` handled by canonical form before wire; players render from snapshot only.

## Task 1: protocol.ts — frame union + (de)serialization

Files: create `src/network/protocol.ts`; test `tests/network/protocol.test.ts`.
Consumes: engine types `GameState, Card, Strain, PlayerIndex, Bid` from `src/engine/types.ts`.
Produces: exported constants/functions:
- `FrameType = 'BID' | 'CALL_PARTNER' | 'PLAY_CARD' | 'GAME_STATE' | 'PLAYER_ASSIGNMENT' | 'ERROR'`
- `type Frame = { type: FrameType; data: unknown }`
- `serializeFrame(f: Frame): string`, `deserializeFrame(s: string): Frame`
- `isInboundCommandType(t: string): boolean`
- `canonicalize<T>(v: T): T` (deep JSON canonicalizer for wire-safe snapshots)
- `serializePlayerAssignment(seat: PlayerIndex, peerId: string): Frame`
- `serializeGameState(s: GameState): Frame`

- [ ] Failing test pins behavior. Run: `vitest run tests/network/protocol.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: frame union, round-trip serialize/deserialize, `canonicalize` handles nested objects/arrays/`null`/`Date`-like strings deterministically, `isInboundCommandType` returns true only for BID/CALL_PARTNER/PLAY_CARD. Run: `vitest run tests/network/protocol.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean.
- [ ] Commit: `git commit -m "feat(network): protocol frame union and serialization" -- src/network/protocol.ts tests/network/protocol.test.ts`

## Task 2: signaling.ts — room lifecycle

Files: create `src/network/signaling.ts`; test `tests/network/signaling.test.ts`.
Consumes: none from earlier (self-contained).
Produces: `interface IBroker { createRoom(): Promise<{ roomKey: string }>; connect(roomKey: string): Promise<void>; }` and a concrete factory `makeBroker(config): IBroker`.

- [ ] Failing test pins behavior. Run: `vitest run tests/network/signaling.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: `makeBroker` returns an `IBroker` whose `createRoom()` yields a long unguessable `roomKey` (>= 24 base36 chars, no UUID) and `connect(roomKey)` validates format then opens the room. A default broker implementation exists but is injectable. Run: `vitest run tests/network/signaling.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean.
- [ ] Commit: `git commit -m "feat(network): signaling room create/connect" -- src/network/signaling.ts tests/network/signaling.test.ts`

## Task 3: peer.ts — seat store + seat reclaim

Files: create `src/network/peer.ts`; test `tests/network/peer.test.ts`.
Consumes: `canonicalize` from `protocol.ts` (task 1); `IBroker` from `signaling.ts` (task 2).
Produces: exported:
- `seatStorageKey(roomKey: string): string` — returns `singaporean-multiplayer.seat.<roomKey>`
- `rememberSeat(roomKey: string, seat: PlayerIndex)`, `readSeat(roomKey: string): PlayerIndex | null`
- `ReclaimMap` class: `set(connId, seat, now)`, `get(connId, now)`, `reconnSeat(connId, now)` returns `seat | null`, `clear()`
- `RECONNECT_WINDOW_MS = 45000` (configurable)
- Seat assignment `assignSeat(hostSeat: PlayerIndex, arrivalOrder: Map<connId, number>): Map<connId, PlayerIndex>` deterministic by arrival order then lexicographic connId.

- [ ] Failing test pins behavior. Run: `vitest run tests/network/peer.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: sessionStorage backed remember/read, `ReclaimMap` respects `RECONNECT_WINDOW_MS` (expired entries return null), `assignSeat` stable and deterministic on tie. Run: `vitest run tests/network/peer.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean.
- [ ] Commit: `git commit -m "feat(network): peer seat store and reclaim" -- src/network/peer.ts tests/network/peer.test.ts`

## Task 4: transport.ts — orchestrates signaling + peer (the app seam)

Files: create `src/network/transport.ts`; test `tests/network/transport.test.ts`.
Consumes: `protocol.ts` (task 1), `signaling.ts` (task 2), `peer.ts` (task 3).
Produces: exported:
- `interface Transport { readonly seat: PlayerIndex; readonly isHost: boolean; onGameState(cb: (s: GameState) => void): void; onPeerAssigned(cb: (a: { seat, peerId }) => void): void; onError(cb: (reason: string) => void): void; sendBid(level, strain): void; sendCallPartner(card: Card): void; sendPlayCard(card: Card): void; onCommand(cb: (frame: Frame) => void): void; destroy(): void; }`
- `makeTransport(opts: { roomKey; isHost; broker?: IBroker }): Promise<Transport>`
- Host mode: inbound frames fed to `makeBid`/`callPartner`/`playCard`; illegal commands return ERROR, not throw.
- Peer mode: outbound commands → wire; inbound GAME_STATE → canonicalized snapshot → `onGameState`.

- [ ] Failing test pins behavior. Run: `vitest run tests/network/transport.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: `makeTransport` connects broker, resolves seat, wires inbound/outbound; host validates commands against authoritative engine state and emits ERROR on rejection; peer emits commands and listens for GAME_STATE. Use a stub broker in tests. Run: `vitest run tests/network/transport.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean.
- [ ] Commit: `git commit -m "feat(network): transport orchestrator app seam" -- src/network/transport.ts tests/network/transport.test.ts`

## Task 5: useGame host/peer awareness

Files: modify `src/hooks/useGame.ts`.
Consumes: `makeTransport` from `transport.ts` (task 4); existing reducers from `gameEngine.ts`.
Produces: `useGame` returns same shape as now PLUS `{ mode: 'solo' | 'host' | 'peer' }` and hosts a transport in host mode; in peer mode it drives the local reducer purely from inbound `GAME_STATE` snapshots (UI renders snapshot, not local mutation). Reducer calls in host mode go through transport commands. No engine file changes.

- [ ] Failing test pins behavior. Run: `vitest run tests/hooks/useGame.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: in host mode, transport feeds commands into existing reducers; in peer mode, inbound snapshot replaces local engine state so the returned state equals the received snapshot. Run: `vitest run tests/hooks/useGame.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean.
- [ ] Commit: `git commit -m "feat(useGame): host-peer transport awareness" -- src/hooks/useGame.ts tests/hooks/useGame.test.ts`

## Task 6: App.tsx + GameTable.tsx mounts multiplayer when present

Files: modify `src/App.tsx`, `src/components/GameTable.tsx`.
Consumes: `useGame` (task 5) with `mode`; transport seat/assignment from transport (task 4).
Produces: `App.tsx` reads `#join/<roomKey>`; if present, mounts multiplayer (host/peer). `GameTable.tsx` renders from `GAME_STATE` snapshot only, no game logic; seat identity from transport `PLAYER_ASSIGNMENT`.

- [ ] Failing test pins behavior. Run: `vitest run tests/components/GameTable.test.ts`. Expected: FAIL (no such file yet).
- [ ] Minimal implementation: `App.tsx` parses fragment, mounts `useGame` in host/peer mode; `GameTable.tsx` renders purely from snapshot and applies seat from transport. Run: `vitest run tests/components/GameTable.test.ts`. Expected: PASS. Run: `tsc -b`. Expected: clean. Run: `npm run build`. Expected: build succeeds.
- [ ] Commit: `git commit -m "feat(ui): multiplayer mount and snapshot render" -- src/App.tsx src/components/GameTable.tsx tests/components/GameTable.test.ts`

## Verification (final)

Run: `vitest run` — Expected: all green.
Run: `tsc -b` — Expected: clean.
Run: `npm run build` — Expected: build succeeds.
Run: `oxlint src tests` — Expected: clean.
