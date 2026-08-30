/**
 * What needs the user, and when.
 *
 * This protocol has time-gated steps a bidder can silently fail: a seed that arrives
 * after the auctioneer has settled, a dispute window that closes leaving a wrong outcome
 * final, a refund nobody claims. None of those produce an error — they just go quiet,
 * and one of them is the only way to actually lose money here.
 *
 * Which makes the *consequence* copy load-bearing, and it was wrong. `send-seed` said a
 * seed not sent forfeits your collateral. `redeem_forfeit` exists precisely so that it
 * does not — "going offline costs a delay, not the money", in the contract's own words.
 * A bidder who read the old text would conclude the money was gone and never come back
 * for it, which is a worse outcome than the one it warned about.
 *
 * Deriving them in one place means the dashboard, the sidebar badge and the topbar
 * counter cannot disagree about whether something is due.
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
          detail:
            (unsent.length === 1
              ? "Sends the seed that lets the auctioneer prove where your bid sits, "
              : `${unsent.length} bids still need a seed. Each one lets the auctioneer `
                + "prove where that bid sits, ")
            + "without revealing it — a bound, never the amount. Send it before they "
            + "settle, which they may do at any moment. Missing it does not burn your "
            + "escrow: the bid is marked forfeited, and you take it back in full after "
            + "finalize with Redeem forfeit. If your bid was above the clearing price, "
            + "dispute instead — that voids the settlement and pays you the auctioneer's "
            + "bond, and it is the one window here that really does shut.",
          cta: "Send seed", href: bidHref,
          /* `dispute_deadline` is written by `settle`, so during `Sealed` — which is the
             only status this action fires in — it is still 0, and `|| null` turned the
             tightest window in the protocol into "No deadline" and sorted it last.

             There is no on-chain deadline for the bidder: the auctioneer settles when
             they like. But the auctioneer's own window has an outer bound, because past
             `sealed_at + dispute_window` anyone can `abandon`. That bound is the honest
             deadline to show, so long as it is not read as a cutoff the chain enforces. */
          deadline: a.sealedAtTime > 0 ? a.sealedAtTime + a.disputeWindow : null,
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
