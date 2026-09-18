# Nits

Small follow-ups deferred from the PeerJS freeze fix (2026-07-19).

- **Timeout tuning**: `PEER_OPEN_TIMEOUT_MS` is a hardcoded 10s magic number in `src/network/peerjs-broker.ts`. Consider making it configurable (env var or constant in a config module) and possibly longer (15-20s) for slow mobile networks where the PeerJS cloud handshake can be sluggish.
- **Self-hosted PeerJS server**: Production depends on `0.peerjs.com` (no SLA, can be rate-limited or geo-blocked). Evaluate a self-hosted PeerJS server or an alternative signaling backend to eliminate the single point of failure.
- **Non-blocking connection error UI**: The current error banner replaces the entire game table on signaling failure. If the connection drops mid-game, the user loses the table view. A non-blocking toast or inline status line would be better UX.
