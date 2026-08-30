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
  | "seal" | "settle" | "finalize" | "abandon";

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
  /** Seconds since epoch. Only `abandon` needs it — it appears once a grace has expired. */
  now: number = Math.floor(Date.now() / 1000),
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
            ? "Sends the seed that lets the auctioneer prove where your bid sits, without "
              + "revealing it. Your bid amount is not disclosed by this. Not sending it "
              + "forfeits your collateral."
            : `${unsent.length} bids still need their seed. Each one unsent is a forfeited `
              + "collateral. Sending reveals a bound, never the amount.",
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
          detail: "You won. This transfers the lot to you and is final — the auction is "
            + "already settled, so nothing about your bid becomes public by claiming it.",
          cta: "Claim lot", href: bidHref, deadline: null,
        });
      }
      if (!won) {
        out.push({
          kind: "claim-refund", auctionId: id, role: "bidder",
          title: `Claim your refund — Auction #${id}`,
          detail: "You did not win, so your whole escrow comes back — the uniform cap, not "
            + "the amount you bid. Claiming reveals nothing; your bid stays sealed.",
          cta: "Claim refund", href: bidHref, deadline: null,
        });
      }
    }

    if (iBid && a.status === Status.Settled) {
      out.push({
        kind: "dispute", auctionId: id, role: "bidder",
        title: `Check the result — Auction #${id}`,
        detail: "The dispute window is open. If your bid was above the price the auctioneer "
          + "claimed, proving it now voids the settlement and pays you their bond. This is "
          + "the only time that is possible — after it closes the outcome is final.",
        cta: "Review", href: bidHref, deadline: a.disputeDeadline,
      });
    }

    /* Abandon is permissionless and is offered to anyone with a stake, not only the
       auctioneer — the whole point is that it works when the auctioneer has gone. It
       appears only once the grace has actually expired, so it is never a button that
       merely refuses. */
    if (a.status === Status.Sealed && (iBid || isAuctioneer)
        && a.sealedAtTime > 0 && now >= a.sealedAtTime + a.disputeWindow) {
      out.push({
        kind: "abandon", auctionId: id, role: iBid ? "bidder" : "auctioneer",
        title: `Auction #${id} was never settled`,
        detail: "The auctioneer's time to settle has run out. Anyone can cancel it now: "
          + "every bidder is refunded in full and takes an equal share of the forfeited "
          + "bond, and the lot goes back to the seller. It cannot be undone.",
        cta: "Abandon", href: bidHref, deadline: null,
      });
    }

    if (isAuctioneer) {
      if (a.status === Status.Open && a.bidDeadline > 0) {
        out.push({
          kind: "seal", auctionId: id, role: "auctioneer",
          title: `Seal Auction #${id}`,
          detail: "Freezes the bid set so no further bids can be added, and stamps the block "
            + "— before any seed can be sent and so before anyone can read an amount. That "
            + "ordering is what stops a bid being dropped after its value is known. It also "
            + "starts your clock to settle.",
          cta: "Seal", href: manageHref, deadline: a.bidDeadline,
        });
      }
      if (a.status === Status.Sealed) {
        out.push({
          kind: "settle", auctionId: id, role: "auctioneer",
          title: `Settle Auction #${id}`,
          detail: "Submits one witness per bid plus a second for the runner-up, proving the "
            + "clearing price without opening a single bid. It moves no money — it opens the "
            + "dispute window, and puts your bond at risk if the outcome is wrong.",
          cta: "Settle", href: manageHref, deadline: null,
        });
      }
      if (a.status === Status.Settled) {
        out.push({
          kind: "finalize", auctionId: id, role: "auctioneer",
          title: `Finalize Auction #${id}`,
          detail: "The dispute window has closed clean, so this releases the funds: the "
            + "clearing price and your bond to the seller, the lot to the winner. Final and "
            + "irreversible.",
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
