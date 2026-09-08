"use client";

import {
  VAULT_CHANNEL, VAULT_KEY, identityOf, restoreEntries, type StoredBid,
} from "@/lib/vault";

/**
 * Cross-tab protection for the vault, and the one thing a deploy cannot fix by itself.
 *
 * The reconciler that deleted six mainnet claim secrets was fixed and shipped. It kept
 * deleting anyway — for hours — because a tab opened before the deploy was still running
 * the old bundle, on its 20-second poll, and nothing shipped afterwards can reach into a
 * tab that already loaded old JavaScript. Two defences follow from that, both here:
 *
 *   1. Evidence-based repair. A `storage` event carries the value before and after. If
 *      another tab's write removed bids and no tab announced proof for those removals on
 *      the channel, this tab puts them back. The old bundle never announces; the current
 *      one announces every proven drop before it writes. So an old tab's wipe is undone
 *      within milliseconds and a legitimate cleanup is left alone.
 *
 *   2. Version skew, named plainly. Every tab announces its build id. A tab that hears a
 *      *newer* one is the old tab and says so, with a reload control. A tab that hears an
 *      *older* one — or that has just had to restore something — tells the user another
 *      tab is on an older version and will keep deleting bids until it is reloaded. Not a
 *      generic "refresh for updates": that banner gets ignored, and this one is the only
 *      protection during the window.
 */

/** `<epoch-millis>.<sha7>`, set at build time. The prefix orders builds. */
let buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "0.dev";
export const BUILD_ID = () => buildId;
export const builtAt = (id: string) => Number(id.split(".")[0]) || 0;

export interface StaleTabState {
  /** Bids this tab has put back after another tab removed them without proof. */
  restored: number;
  lastRestoredAt: number | null;
  /** Build id of an older tab that announced itself, if any. */
  olderTab: string | null;
  /** A newer build announced itself: this tab is the old one. */
  thisTabOld: boolean;
}
const initial: StaleTabState = { restored: 0, lastRestoredAt: null, olderTab: null, thisTabOld: false };
let state: StaleTabState = initial;
const subs = new Set<() => void>();
const patch = (p: Partial<StaleTabState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const staleTabState = () => state;
export function subscribeStaleTab(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

/** Removals other tabs have announced with proof, by identity, with when. */
const announced = new Map<string, number>();
/** How long an announcement stays valid. A drop and its storage event arrive together. */
const ANNOUNCE_TTL = 60_000;
/** Time allowed for the announcement to land before a shrink is treated as unproven. */
const GRACE = 300;

const parse = (raw: string | null): StoredBid[] => {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v as StoredBid[] : []; }
  catch { return []; }
};

let stop: (() => void) | null = null;

export function startVaultSync(): void {
  if (stop || typeof window === "undefined") return;

  let ch: BroadcastChannel | null = null;
  try { ch = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(VAULT_CHANNEL); }
  catch { ch = null; }
  (ch as unknown as { unref?: () => void } | null)?.unref?.();

  const onMessage = (e: MessageEvent) => {
    const m = e.data as { type?: string; ids?: unknown; build?: unknown } | null;
    if (!m) return;
    if (m.type === "removed" && Array.isArray(m.ids)) {
      const now = Date.now();
      for (const id of m.ids) if (typeof id === "string") announced.set(id, now);
      return;
    }
    if ((m.type === "hello" || m.type === "here") && typeof m.build === "string" && m.build !== buildId) {
      if (builtAt(m.build) < builtAt(buildId)) patch({ olderTab: m.build });
      else patch({ thisTabOld: true });
    }
    if (m.type === "hello") ch?.postMessage({ type: "here", build: buildId });
  };
  ch?.addEventListener("message", onMessage);
  ch?.postMessage({ type: "hello", build: buildId });

  const timers = new Set<number>();
  const onStorage = (e: StorageEvent) => {
    if (e.key !== VAULT_KEY) return;
    const after = new Set(parse(e.newValue).map(identityOf));
    const lost = parse(e.oldValue).filter((b) => !after.has(identityOf(b)));
    if (!lost.length) return;
    const t = window.setTimeout(() => {
      timers.delete(t);
      const cutoff = Date.now() - ANNOUNCE_TTL;
      const unproven = lost.filter((b) => !((announced.get(identityOf(b)) ?? 0) > cutoff));
      if (!unproven.length) return;
      const n = restoreEntries(unproven);
      if (n) patch({ restored: state.restored + n, lastRestoredAt: Date.now() });
    }, GRACE);
    timers.add(t);
  };
  window.addEventListener("storage", onStorage);

  stop = () => {
    window.removeEventListener("storage", onStorage);
    ch?.removeEventListener("message", onMessage);
    ch?.close();
    timers.forEach((t) => window.clearTimeout(t));
    stop = null;
  };
}

/* Test seams. Production never calls these. */
export function _resetVaultSyncForTest(nextBuildId?: string) {
  stop?.();
  state = initial;
  announced.clear();
  if (nextBuildId !== undefined) buildId = nextBuildId;
}
