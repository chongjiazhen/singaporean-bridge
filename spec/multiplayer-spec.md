# Singaporean Floating Bridge — Host-Authoritative P2P Multiplayer (M)

## Goal

Add **4-player browser P2P, host-authoritative, invite-link-based multiplayer** to the existing
Singaporean Floating Bridge app, with **zero persistent game backend**. The game stays a static
GitHub Pages app; the host's browser runs the real engine and is the authoritative game server.
Peers never run the engine — they send commands, the host applies them, and broadcasts resulting
state. Transport is a managed signaling + relay broker (PeerJS-class); the repo stays fully static.

## Architecture diagram

```
                    GitHub Pages (static)
        https://chongjiazhen.github.io/singaporean-bridge/
                     │  loads app once
                     ▼
        ┌──────────────────────────────┐
        │   Singaporean Bridge app      │   (same entry point, no new server)
        └──────────────────────────────┘
                     │
        Host clicks "Create Game" → broker creates room → roomKey
                     │
        invite = location.href + "#join/<roomKey>"   (browser never sends #fragment to HTTP)
                     │
     ┌────────────────┼───────────────┼───────────────┐
     ▼                ▼                ▼
   Peer B           Peer C            Peer D          (each joins by order of arrival)
     │                │                │                seat = (hostSeat + arrivalPosition) % 4
     │                │                │
     │                │                │
   ──────────────────────────────────────────── WebRTC data channel (broker relays) ────────────
     │                │                │
     └────────────────┼───────────────┐
                     ▼
        ┌───────────────────────────────┐
        │  HOST  (seat X)                │
        │  game engine (host-authoritative)
        │  engine.makeBid / callPartner / playCard / pass
        │  seat X  seat X+1 seat X+2 seat X+3
        │  (any empty seat filled by host's own engine = bot)
        └───────────────────────────────┘
```

The host owns the engine (the pure state machine in `src/engine`). Peers send **commands**, never
state. Any seat with no human is simulated by the host's own engine and carries **no network identity**.

## Network layer

New subfolder `src/network/`. No game logic leaks into `network/`; it deals only in transport and frames.

```
src/network/
├── signaling.ts      Room lifecycle + broker handle creation (create room, get roomKey, connect to room).
├── peer.ts           Peer lifecycle: join as seat X+pos, store seat in sessionStorage, reclaim seat on reconnect.
├── protocol.ts       Frame type unions, (de)serialization, per-player ordered channel semantics.
└── transport.ts      Orchestrates signaling + peer; the seam the app calls into.
```

- **signaling** — one broker handle. On "Create Game" it calls the broker's create-room API to obtain a `roomKey`. On join it connects to the room keyed by the room key parsed from `#join/<roomKey>`. Broker guarantees secure context (HTTPS) and room isolation.
- **peer** — each browser establishes a **per-player ordered channel** to the host. The broker delivers that player's frames strictly in arrival order (Q6). The peer stores its seat index in `sessionStorage`; on reconnect it sends its remembered seat so the host reclaims it (Q4).
- **protocol** — the wire format. No sequence numbers (Q5); ordering is broker-provided per channel.

## Broker selection (resolved)

**Decision (peer-backed, managed).** The broker is **PeerJS, consumed via its managed PeerServer Cloud
service** (`peerjs.com`; client `peerjs` npm latest `1.5.5`, server `peer` npm `1.0.2`). Chosen because it
is the only candidate satisfying all three hard constraints:

- **Static repo preserved.** PeerJS is a *hosted* broker (`0.peerjs.com:443`); the repo adds only the
  `peerjs` **browser SDK** and ships **no** server. The `docs/`-only GitHub Pages deploy is unchanged.
  (Self-hosted `peer`/PeerServer, the offline `rtcmultiplayer`, and the `livepeer` video-CDN platform were
  rejected; `webrtcadapter`/`peergraph` were unverified here.) See
  `docs/re research/2026-09-16-peer-broker-selection.md`.
- **Data plane stays direct.** PeerJS wraps WebRTC with DTLS; frames travel host↔peer, never through the broker.
  The broker owns signaling + NAT traversal + relay fallback only.
- **Contract met out of the box.** A room is the host's *fixed* brokering id; a random 24+ char `roomKey` used
  as that id yields room routing **and** invite-secret unguessability in one value (PeerJS collides only when two
  rooms reuse an id). Peers join with `peer.connect(roomKey)`; per-peer `DataConnection` channels are ordered
  and reliable.

**Wiring seam (one).** PeerJS is wired to the existing `TransportBroker` contract in `transport.ts` — the single
seem the app consumes. No change to that contract; only a new implementation of it. The wiring maps
`createRoom()`/`connect()` and the ordered per-player channel methods onto `Peer`/`DataConnection`:

```
TransportBroker  ── implemented by ──►  PeerJsBroker (peerjs SDK, managed PeerServer Cloud)
  createRoom()/connect()       ->  host fixed-id = roomKey; peer connect(roomKey)
  onPeerConnect/onPeerDisconnect ->  Peer 'connection' / DataConnection 'close'
  onInboundFrame(peerId, frame)->  DataConnection 'data'   (ordered per channel)
  deliverToPeer(peerId, frame) ->  connection.send(frame)
  sendToPeer(frame)            ->  this peer's DataConnection.send(frame) to the host
  onPeerReady({peerId, seat})  ->  DataConnection 'open'   (seat via metadata, for reclaim)
  disconnect()                 ->  Peer.destroy()
```

The wire format is locked at this seam by `transport.ts`'s existing `wireFrame()` serialize↔deserialize
round-trip, so any future broker (including re-selection) must match the declared frame format. PeerJS is the
chosen managed broker, but the seam keeps re-selection a drop-in swap.

Verification before wiring (recorded in detail in the research brief): confirm the `peerjs` import path
and that `new Peer(fixedId)` fixed-id semantics hold in the installed build; confirm `0.peerjs.com:443`
reachability behind typical NAT/firewalls (the spec's TURN/relay-tuning toggle). Neither blocks the design.

## Protocol definition

Frame envelope on every transport frame:

```
{ type: 'BID' | 'CALL_PARTNER' | 'PLAY_CARD' | 'GAME_STATE' | 'PLAYER_ASSIGNMENT' | 'ERROR',
  data: <frame-specific payload> }
```

### Inbound — player → host (commands only, never state)

| type | payload | applied via reducer |
|---|---|---|
| `BID` | `{ level: number (1-7), strain: Strain }` | `engine.makeBid(state, seat, level, strain)` |
| `CALL_PARTNER` | `{ card: Card }` | `engine.callPartner(state, seat, card)` |
| `PLAY_CARD` | `{ card: Card }` | `engine.playCard(state, seat, card)` |

- Only seat index and command. The host re-derives the legal command against its own state; illegal commands return `ERROR` rather than throwing.
- `pass` is host-driven (the host decides when a player passes the auction); no inbound frame. `getLegalPlays` / `canPass` queries live in the host.

### Outbound — host → players (state, not commands)

| type | payload | when |
|---|---|---|
| `GAME_STATE` | full diffable `GameState` snapshot | after any applied command; carried from hand to hand |
| `PLAYER_ASSIGNMENT` | `{ seat: PlayerIndex, peerId: string }` | when a new peer is seated |
| `ERROR` | `{ reason: string, commandId?: number }` | when an inbound command is rejected |

- `GAME_STATE` is the source of truth players render; the UI renders from the received snapshot, not from its own engine.
- `PLAYER_ASSIGNMENT` tells peers that a seat is now a human and no longer bot-filled.

### Ordering contract

The broker delivers each player's frames **in arrival order** on its channel. The host applies inbound frames **strictly in the order received**; the protocol carries **no sequence numbers**. Reordering is not permitted — a stale click that would corrupt state is rejected via `ERROR` against the host's authoritative state, not reordered.

## Seat assignment algorithm

Host is seat `X = hostSeat`. Incoming peers are seated by **order of arrival**:

```
seat = (hostSeat + arrivalPosition) % 4
```

where `arrivalPosition` is 1 for the first joined peer, 2 for the second, 3 for the third. Stable for the session. The host maintains an in-memory map `connectionId -> seat` for the lifetime of the room (reset each hand). Because the game rotates by seating (auction opener is "dealer's left" = seat `+1`; trick leader is "declarer's left"; trumps led by "declarer's left"), seat identity is game-critical, so assignment is fixed at connect and never re-derives from a stale connection.

## Reconnect / rejoin behavior

- Each peer stores its seat index in `sessionStorage` keyed by `roomKey`.
- The host holds a **bounded pre-join state**: a map `connectionId -> seat` (or `{ seat, lastSeen }`) for connections it has seen this room/hand.
- On reconnect the peer sends its remembered seat; the host **reclaims that seat** for the returning connection (bounded to a window — once the window passes, the seat is bot-filled until reclaimed).
- A reconnecting peer that drops **mid-trick** may be **temporarily bot-filled** until it rejoins; during that window the host's engine simulates the seat and other players see no anomaly.
- `sessionStorage` is session-scoped: closing the tab clears the remembered seat, so a reopened tab becomes a fresh peer (option A semantics).

## Invite and session identity

- **Room key = invite secret.** One value is the room secret + routing key + session identity.
- On "Create Game": `signaling.createRoom()` → broker returns a `roomKey`. No server to run.
- Invite link = `location.href + "#join/<roomKey>"` (copied to clipboard). The fragment `#join/<roomKey>` is never sent to the HTTP server.
- Players open the link → app loads, parses `#join/<roomKey>`, and connects to that room via the broker.
- Broker isolates the room by key; no other game can claim the same key.
- `sessionStorage[roomKey] = seatIndex` on connect.

## Bot-fill behavior (empty seats)

- Seats with no human peer are **filled by the host's own engine**. A bot-filled seat is simulated entirely in the host; it **carries no network identity, cannot drop or reconnect, and is NEVER a network peer.**
- The host's engine maintains a `seat -> humanId | null` map. `null` seats are bot-filled: the engine drives that seat's turns internally (mirroring the existing AI-player logic in `src/ai/aiPlayer.ts`), and the host sends `PLAYER_ASSIGNMENT` only when a real peer reclaims the seat.
- A bot-filled seat is invisible to the protocol layer: it participates in the game, never in the wire format.
- The number of human peers is 0–3 (the host seat plus up to three extra humans).

## Security isolation

- **Invite unguessability:** the room key is a long, random, unguessable secret; the broker treats rooms keyed by it as isolated. No other game can claim a room once created.
- **No state spoofing:** peers may only send `BID` / `CALL_PARTNER` / `PLAY_CARD` commands for seats they own. The host re-validates each against its authoritative engine; it rejects or ignores commands that don't fit the current state.
- **Transport security:** all frames over the broker's secure context (HTTPS). WebRTC opens in the page; secure context is required by the broker.
- **Relay fallback:** a managed-broker relay exists for players whose network cannot connect directly (NAT/firewall). Bandwidth is microscopic for this game.
- **Session-scoping:** `sessionStorage` keyed by room key ensures an invite secret is scoped to the current session, not persisted beyond it.

## File layout changes to the existing repo

```
src/
├── engine/                        (unchanged — the pure state machine the host runs)
│   ├── types.ts                   GameState, Phase, GameRules, Card, Strain, Bid
│   ├── gameEngine.ts              makeBid, callPartner, playCard, pass, startAuction, …
│   ├── trickEvaluator.ts          (unchanged)
│   └── ai/aiPlayer.ts             (unchanged — reused for bot-filled seats in host)
├── network/                        (NEW — transport only, no game logic)
│   ├── signaling.ts               room create / connect via broker
│   ├── peer.ts                    seat store, seat reclaim on reconnect
│   ├── protocol.ts                frame union + (de)serialize
│   └── transport.ts               orchestrates signaling + peer; app seam
├── hooks/
│   └── useGame.ts                 (NEW host/peer awareness; reducer calls now driven by transport)
├── App.tsx                        (reads #join/<roomKey>, mounts multiplayer when present)
└── components/GameTable.tsx       (renders from GAME_STATE; no game logic)
```

- `useGame` gains a host-vs-peer mode: in host mode the transport feeds commands into the existing reducers (`makeBid`, `callPartner`, `playCard`, `pass`); in peer mode the UI renders the received `GAME_STATE` snapshot.
- The engine files (`types.ts`, `gameEngine.ts`) are **not** changed — the host runs the existing engine verbatim.

## Non-goals / deferred work

- **Spore integration** — explicitly optional inspiration only; not a dependency. The transport is a managed broker, not WebTorrent.
- **TURN/relay tuning** — record as a config toggle; do not block.
- **Server-side rooms** — no custom signaling server (managed broker owns discovery + relay).
- **Persistent game backend** — none. State is ephemeral per session, keyed by the room fragment.
- **Guest lobby / accounts / lobby** — out of scope.

## Open questions

1. **Broker selection** — **resolved.** Managed broker = **PeerJS via PeerServer Cloud** (`0.peerjs.com:443`); wired at the single `TransportBroker` seam in `transport.ts` (see the Broker selection section). Remaining checks are the two
   `[NEEDS CLARIFICATION]` items above (peerjs import path; cloud reachability), not re-selection.
2. **Reconnect window size** — the bounded pre-join window the host holds; pick a concrete duration (e.e., 30–60 s per hand).
3. **Bot-fill quality** — reuse the existing AI-player (`aiPlayer.ts`) policy for bot seats, or define a separate minimal policy?
4. **Seat-assignment edge** — if two peers join in the same network tick, arrival order may be ambiguous; decide whether to serialize the first two joins deterministically.
5. **GAME_STATE diffability** — confirm `GameState` serializes cleanly across the wire (e.e., `Set` fields, `null` phases); add a canonicalizer in `protocol.ts` if needed.
