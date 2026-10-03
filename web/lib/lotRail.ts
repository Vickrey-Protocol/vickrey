/**
 * How a lot was actually collected, read from the transaction that collected it.
 *
 * The Resolved card said "collected privately" whenever the lot had been claimed, but
 * `claim_lot` has a public path too — straight to the caller's address — and the
 * Sepolia lots were collected that way. A lot that went through the pool did so in a
 * transaction that also carries the anonymizer's `Routed` event; one that did not, did
 * not. That is the whole test, and it is the chain's answer rather than this browser's.
 */
export type LotRail = "private" | "public";

export function lotRail(
  events: Array<{ from_address: string }>,
  anonymizer: string,
): LotRail | null {
  if (!anonymizer) return null;
  const anon = BigInt(anonymizer);
  return events.some((e) => BigInt(e.from_address) === anon) ? "private" : "public";
}

/** The fact on the Resolved card. Never says more than the chain established. */
export function lotLabel(claimed: boolean, rail: LotRail | null | undefined): string {
  if (!claimed) return "awaiting collection";
  if (rail === "private") return "collected privately";
  if (rail === "public") return "collected to a public address";
  return "collected";
}
