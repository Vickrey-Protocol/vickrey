/**
 * What needs the user, and when.
 *
 * This protocol has time-gated steps a bidder can silently fail: a seed that is never
 * sent forfeits collateral, a dispute window that closes leaves a wrong outcome final,
 * a refund nobody claims stays in the contract. None of those produce an error — they
 * just quietly cost the user money. Deriving them in one place means the dashboard, the
 * sidebar badge and the topbar counter cannot disagree about whether something is due.
 *
 * Deadlines are seconds since epoch, absolute. Rendering decides how to say it; R4
 * requires both a countdown and the UTC time, and a helper that returned only one of
 * them would make the other easy to forget.
 */
import { Status } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import type { StoredBid } from "@/lib/vault";
import { sameAddress } from "@/lib/wallet";

export type ActionKind =
  | "send-seed" | "claim-refund" | "claim-lot" | "dispute"
  | "seal" | "settle" | "finalize";

export interface DueAction {
  kind: ActionKind;
  auctionId: bigint;
  title: string;
  detail: string;
  cta: string;
  href: string;
  /** Absolute, seconds since epoch. Null when the step has no deadline of its own. */
  deadline: number | null;
  role: "bidder" | "auctioneer";
}

export function actionsFor(
  auctions: AuctionView[],
  mine: StoredBid[],
  address: string | null,
): DueAction[] {
  if (!address) return [];
  const out: DueAction[] = [];
  const byAuction = (id: bigint) => mine.filter((b) => BigInt(b.auctionId) === id);

  for (const a of auctions) {
    const id = a.terms.auctionId;
    const bids = byAuction(id);
    const iBid = bids.length > 0;
    const isAuctioneer = sameAddress(address, a.auctioneer);
    const bidHref = `/auction/${id}`;
    const manageHref = `/app/manage/${id}`;

    if (iBid && a.status === Status.Sealed) {
      const unsent = bids.filter((b) => b.revealedAt === undefined);
      if (unsent.length) {
        out.push({
          kind: "send-seed", auctionId: id, role: "bidder",
          title: `Send your seed — Auction #${id}`,
          detail: unsent.length === 1
            ? "Without it your bid cannot be counted and your collateral is forfeited."
            : `${unsent.length} bids still need their seed. Unsent means forfeited.`,
          cta: "Send seed", href: bidHref, deadline: a.disputeDeadline || null,
        });
      }
    }

    if (iBid && a.status === Status.Finalized) {
      const won = bids.some((b) => b.index === a.winnerIndex);
      if (won && !a.lotClaimed) {
        out.push({
          kind: "claim-lot", auctionId: id, role: "bidder",
          title: `Claim your lot — Auction #${id}`,
          detail: "You won. The lot is waiting in the contract.",
          cta: "Claim lot", href: bidHref, deadline: null,
        });
      }
      if (!won) {
        out.push({
          kind: "claim-refund", auctionId: id, role: "bidder",
          title: `Claim your refund — Auction #${id}`,
          detail: "You did not win. Your escrow is refundable in full.",
          cta: "Claim refund", href: bidHref, deadline: null,
        });
      }
    }

    if (iBid && a.status === Status.Settled) {
      out.push({
        kind: "dispute", auctionId: id, role: "bidder",
        title: `Check the result — Auction #${id}`,
        detail: "The dispute window is open. If the outcome is wrong, this is the only time it can be challenged.",
        cta: "Review", href: bidHref, deadline: a.disputeDeadline,
      });
    }

    if (isAuctioneer) {
      if (a.status === Status.Open && a.bidDeadline > 0) {
        out.push({
          kind: "seal", auctionId: id, role: "auctioneer",
          title: `Seal Auction #${id}`,
          detail: "Bidding has closed. Sealing freezes the bid set before anything can be opened.",
          cta: "Seal", href: manageHref, deadline: a.bidDeadline,
        });
      }
      if (a.status === Status.Sealed) {
        out.push({
          kind: "settle", auctionId: id, role: "auctioneer",
          title: `Settle Auction #${id}`,
          detail: "Every bid needs a witness. Settlement proves the clearing price without opening one.",
          cta: "Settle", href: manageHref, deadline: null,
        });
      }
      if (a.status === Status.Settled) {
        out.push({
          kind: "finalize", auctionId: id, role: "auctioneer",
          title: `Finalize Auction #${id}`,
          detail: "Once the dispute window closes, finalizing releases the funds.",
          cta: "Finalize", href: manageHref, deadline: a.disputeDeadline,
        });
      }
    }
  }

  // Soonest first; anything without a deadline sinks below everything that has one,
  // because a dated obligation is the one that can be missed.
  return out.sort((x, y) => {
    if (x.deadline === null && y.deadline === null) return 0;
    if (x.deadline === null) return 1;
    if (y.deadline === null) return -1;
    return x.deadline - y.deadline;
  });
}

/** Under an hour is where a missed step becomes likely rather than possible. */
export const isUrgent = (a: DueAction, now: number) =>
  a.deadline !== null && a.deadline > now && a.deadline - now < 3600;

/** Only actions the user can still act on before a window shuts. */
export const openActions = (list: DueAction[]) => list.length;
