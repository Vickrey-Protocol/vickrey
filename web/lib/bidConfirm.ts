/**
 * Whether a bid landed, asked of the auction itself.
 *
 * A wallet's answer is not evidence: Xverse has thrown with no hash for a transaction
 * that was already sent, and a timeout says nothing at all. The vault entry is written
 * before the wallet is called, so the commitment and anchors are always known — and the
 * v2 contract answers `bid_index_of(auction, anchor)` in one read.
 *
 * The verdicts, and what each allows the screen to say:
 *   placed     — a bid carrying our up-anchor exists, and its commitment and down-anchor
 *                are ours. "Placed", with the real index.
 *   reverted   — the receipt says so. No bid, no escrow moved.
 *   absent     — we looked for the whole window, every read answered, nothing is
 *                there, and the auction is still open. "Safe to try again".
 *   closed     — absent, and bidding has closed. "Not placed".
 *   unknown    — the chain could not be read. Say that, and do not guess either way.
 */
export type BidVerdict =
  | { kind: "placed"; index: number }
  | { kind: "reverted"; reason: string }
  | { kind: "absent" }
  | { kind: "closed" }
  | { kind: "unknown"; why: string };

export interface Probe {
  /** `bid_index_of(auction, upAnchor)`, or null for `NO_BID`. Throws on a failed read. */
  indexOf(): Promise<number | null>;
  /** The stored commitment and down-anchor at `index`. Throws on a failed read. */
  bidAt(index: number): Promise<{ commitment: bigint; downAnchor: bigint }>;
  /** Whether bidding is still open now. Throws on a failed read. */
  stillOpen(): Promise<boolean>;
  /** The receipt's outcome, when there is a hash. */
  receipt?(): Promise<"succeeded" | { reverted: string } | "unknown">;
}

export interface Mine {
  commitment: bigint;
  downAnchor: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until the bid is found, the receipt reverts, or `windowMs` passes. Every read
 * that fails is remembered: a window in which any read failed cannot conclude "absent".
 */
export async function confirmBid(
  probe: Probe, mine: Mine,
  opts: { windowMs?: number; everyMs?: number; onTick?: (elapsedMs: number) => void } = {},
): Promise<BidVerdict> {
  const windowMs = opts.windowMs ?? 90_000;
  const everyMs = opts.everyMs ?? 5_000;
  const start = Date.now();
  let failures = 0;
  let lastError = "";

  while (true) {
    if (probe.receipt) {
      try {
        const r = await probe.receipt();
        if (typeof r === "object") return { kind: "reverted", reason: r.reverted };
      } catch { /* the receipt is a shortcut, not the authority */ }
    }
    try {
      const index = await probe.indexOf();
      if (index !== null) {
        const at = await probe.bidAt(index);
        if (at.commitment === mine.commitment && at.downAnchor === mine.downAnchor) {
          return { kind: "placed", index };
        }
        /* An anchor can be held by only one bid, so a different commitment here means
           someone copied our anchors first. Our bid cannot land; say it plainly. */
        return { kind: "unknown", why: `bid #${index} carries this bid's anchor but not its claim` };
      }
    } catch (e) {
      failures += 1;
      lastError = e instanceof Error ? e.message : String(e);
    }

    const elapsed = Date.now() - start;
    opts.onTick?.(elapsed);
    if (elapsed >= windowMs) break;
    await sleep(everyMs);
  }

  if (failures > 0) return { kind: "unknown", why: lastError || "the chain did not answer" };
  try {
    return (await probe.stillOpen()) ? { kind: "absent" } : { kind: "closed" };
  } catch (e) {
    return { kind: "unknown", why: e instanceof Error ? e.message : String(e) };
  }
}
