/**
 * Deal-seed propagation for seeded-RNG deals (Phase B).
 *
 * The host mints a seed on room creation and stores it keyed by roomKey in
 * sessionStorage (session-scoped, survives the same-tab hash navigation
 * `#host/<key>`). Host rooms read it back so every fresh deal is reproducible
 * from that seed.
 *
 * Propagation note (deliberately minimal): the authoritative GAME_STATE snapshot
 * already carries the actual deal to peers, so peers render the same deal the
 * host produced — seeding is complementary (deal determinism + F5
 * reproducibility of a fresh deal), not a replacement for the snapshot. The
 * seed therefore only needs to reach the host instance (same tab); peers do not
 * run the authoritative engine and so do not need it. Keeping propagation in
 * sessionStorage avoids mashing the seed into the room key (which must match
 * `^[a-z0-9]{24,}$` and stay unguessable) or adding a new wire frame.
 */
export const DEAL_SEED_STORAGE_PREFIX = 'singaporean-multiplayer.seed.';

/** Build the sessionStorage key for a room's deal seed. */
export function dealSeedKey(roomKey: string): string {
  return `${DEAL_SEED_STORAGE_PREFIX}${roomKey}`;
}

/** Mint a fresh 32-bit seed for a room's deals. */
export function mintSeed(): number {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  const raw = cryptoObj?.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  return raw >>> 0;
}

/** Persist a host's deal seed for a room (best-effort; failures are non-fatal). */
export function setHostSeed(roomKey: string, seed: number): void {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!storage) return;
    storage.setItem(dealSeedKey(roomKey), String(seed >>> 0));
  } catch {
    /* storage unavailable; the host's deal simply stays unseeded this session */
  }
}

/** Read a room's persisted deal seed, or undefined if none / storage missing. */
export function readSeed(roomKey: string): number | undefined {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!storage) return undefined;
    const raw = storage.getItem(dealSeedKey(roomKey));
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : (n >>> 0);
  } catch {
    return undefined;
  }
}
