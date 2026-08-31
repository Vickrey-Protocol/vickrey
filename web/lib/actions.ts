/**
 * What needs the user, and when.
 *
 * This protocol has time-gated steps a bidder can silently fail: a seed that arrives
 * after the auctioneer has settled, a dispute window that closes leaving a wrong outcome
 * final, a refund nobody claims. None of those produce an error — they just go quiet.
 *
 * Deriving them in one place means the dashboard, the sidebar badge and the notification
 * bell cannot disagree about whether something is due.
 *
 * Two rules hold this file together, and both were learned by breaking them.
 *
 * **Everything listed here must be callable right now.** `seal` reverts before the bid
 * deadline, `finalize` reverts until the dispute window has closed, `dispute` reverts
 * once it has. All three were listed the moment the status matched, so the queue offered
 * steps the chain would reject — and a queue that does that teaches the user to ignore
 * it, which is the one thing it cannot afford.
 *
 * **The consequence is content, not decoration.** `send-seed` said a seed not sent
 * forfeits your collateral; `redeem_forfeit` exists precisely so that it does not —
 * "going offline costs a delay, not the money", in the contract's own comment. A bidder
 * who read that would conclude the money was gone and never come back for it. So
 * `consequence` is its own field rather than a clause inside `detail`: what a step *does*
 * and what it costs to *miss* are different questions, and only one of them is why
 * anybody reads this list.
 *
 * Deadlines are seconds since epoch, absolute. Rendering decides how to say it; R4
 * requires both a countdown and the UTC time, and a helper that returned only one of
 * them would make the other easy to forget.
 */
import { Status } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import type { BidState } from "@/lib/chain";
import type { StoredBid } from "@/lib/vault";
import { sameAddress } from "@/lib/wallet";

export type ActionKind =
  | "send-seed" | "claim-refund" | "claim-lot" | "dispute"
  | "seal" | "settle" | "finalize" | "abandon";

/**
 * `hard` — the chain refuses the call once `deadline` passes.
 * `bound` — the window can close sooner than `deadline`; it is an outer limit, not a
 *   cutoff. Saying "closes in 58m" about one of these would be a promise nothing keeps.
 */
export type DeadlineKind = "hard" | "bound";

export interface DueAction {
  kind: ActionKind;
  auctionId: bigint;
  title: string;
  /** What the step does. */
  detail: string;
  /** What it costs to miss it. Never a euphemism, and never worse than the truth. */
  consequence: string;
  cta: string;
  href: string;
  /** Absolute, seconds since epoch. Null when the step has no deadline of its own. */
  deadline: number | null;
  deadlineKind: DeadlineKind;
  role: "bidder" | "auctioneer";
}

export function actionsFor(
  auctions: AuctionView[],
  mine: StoredBid[],
  address: string | null,
  /** Seconds since epoch. Every window gate below is measured against it. */
  now: number = Math.floor(Date.now() / 1000),
  /** On-chain per-bid state, keyed `auctionId:index`. Absent means not read yet. */
  bidStates: Map<string, BidState> = new Map(),
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
    /* The auctioneer's outer limit. `abandon` becomes callable here, so it bounds the
       bidder's seed window too — after it the auction can be cancelled out from under
       both of them. */
    const settleBy = a.sealedAtTime > 0 ? a.sealedAtTime + a.disputeWindow : null;

    if (iBid && a.status === Status.Sealed) {
      const unsent = bids.filter((b) => b.revealedAt === undefined);
      if (unsent.length) {
        out.push({
          kind: "send-seed", auctionId: id, role: "bidder",
          title: unsent.length === 1
            ? `Send your seed — Auction #${id}`
            : `Send ${unsent.length} seeds — Auction #${id}`,
          /* This said "a bound, never the amount", which is false. The reveal is
             `{index, seed, level}` and carries the level explicitly — and even without
             it, the seed walks the chain, so any holder can find the level by trying all
             P of them. "A bound, never the amount" describes what goes *on chain*, and
             borrowing it for what the bidder hands the auctioneer overstated the
             property in the one place a bidder decides whether to hand it over. */
          detail: unsent.length === 1
            ? "Hands the auctioneer your seed and level. They learn your exact bid — "
              + "safely, because the bid set is already frozen, so knowing it cannot "
              + "change which bids exist. The chain still never sees an amount."
            : `${unsent.length} of your bids still need a seed. The auctioneer learns `
              + "each exact bid, after the set was frozen, so the knowledge cannot change "
              + "which bids exist. The chain still never sees an amount.",
          consequence:
            "The auctioneer settles without you and the bid is marked forfeited. That is "
            + "recoverable, not lost: at or below the clearing price you take the whole "
            + "escrow back after finalize with Redeem forfeit; above it you dispute "
            + "instead, which voids the settlement and pays you the auctioneer's bond.",
          cta: "Send seed", href: bidHref,
          /* `dispute_deadline` is written by `settle`, so during `Sealed` — the only
             status this fires in — it is still 0, and the old `|| null` turned the
             tightest window in the protocol into "No deadline", which sorts last.

             There is no on-chain deadline for the bidder: the auctioneer settles when
             they like. `bound` says exactly that. */
          deadline: settleBy, deadlineKind: "bound",
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
            + "already settled, so nothing about your bid becomes public by claiming it. "
            + "It is one of two collections, not both.",
          consequence: "Nothing expires. The lot waits in the contract until you take it, "
            + "but only this browser's claim secret can release it.",
          cta: "Claim lot", href: bidHref, deadline: null, deadlineKind: "hard",
        });
      }
      /* The winner's surplus. `claim-refund` used to be guarded by `!won`, so a winner
         was told to collect the lot and nothing else — and `finalize` had already taken
         the clearing price out of their escrow, leaving the remainder sitting in the
         contract with nothing in the app ever mentioning it.

         Listed only once the chain says it is still unclaimed, so it disappears when
         taken rather than offering a call that would revert. */
      const winnerBid = won ? bids.find((b) => b.index === a.winnerIndex) : undefined;
      const winnerState = winnerBid
        ? bidStates.get(`${winnerBid.auctionId}:${winnerBid.index}`)
        : undefined;
      if (won && winnerState && !winnerState.claimed) {
        out.push({
          kind: "claim-refund", auctionId: id, role: "bidder",
          title: `Claim your surplus — Auction #${id}`,
          detail: "You escrowed the top of the ladder and paid the clearing price, which "
            + "came out of that escrow when the auction was finalized. The difference is "
            + "yours and is still in the contract.",
          consequence: "Nothing expires, and claiming the lot does not collect this — they "
            + "are two separate calls. It waits until you take it, and only this browser's "
            + "claim secret can release it.",
          cta: "Claim surplus", href: bidHref, deadline: null, deadlineKind: "hard",
        });
      }
      if (!won) {
        out.push({
          kind: "claim-refund", auctionId: id, role: "bidder",
          title: `Claim your refund — Auction #${id}`,
          detail: "You did not win, so your whole escrow comes back — the uniform cap, not "
            + "the amount you bid. Claiming reveals nothing; your bid stays sealed.",
          consequence: "Nothing expires. The escrow waits in the contract until you claim "
            + "it, but only this browser's claim secret can release it.",
          cta: "Claim refund", href: bidHref, deadline: null, deadlineKind: "hard",
        });
      }
    }

    /* `dispute` reverts once the deadline passes, and the status stays `Settled` until
       someone finalizes — so status alone would keep offering a call that cannot land. */
    if (iBid && a.status === Status.Settled && now < a.disputeDeadline) {
      out.push({
        kind: "dispute", auctionId: id, role: "bidder",
        title: `Check the result — Auction #${id}`,
        detail: "The dispute window is open. If your bid was above the price the auctioneer "
          + "claimed, proving it now voids the settlement and pays you their bond.",
        consequence: "The outcome becomes final and cannot be challenged again. This is the "
          + "only window in the protocol that shuts on the bidder, and the only one where "
          + "being late actually costs you the money.",
        cta: "Review", href: bidHref,
        deadline: a.disputeDeadline, deadlineKind: "hard",
      });
    }

    /* Abandon is permissionless and is offered to anyone with a stake, not only the
       auctioneer — the whole point is that it works when the auctioneer has gone. It
       appears only once the grace has actually expired, so it is never a button that
       merely refuses. */
    if (a.status === Status.Sealed && (iBid || isAuctioneer)
        && settleBy !== null && now >= settleBy) {
      out.push({
        kind: "abandon", auctionId: id, role: iBid ? "bidder" : "auctioneer",
        title: `Auction #${id} was never settled`,
        detail: "The auctioneer's time to settle has run out. Anyone can cancel it now: "
          + "every bidder is refunded in full and takes an equal share of the forfeited "
          + "bond, and the lot goes back to the seller.",
        consequence: "Nothing gets worse and nothing expires — the auction simply stays "
          + "stuck, with everyone's escrow in it, until somebody does this.",
        cta: "Abandon", href: bidHref, deadline: null, deadlineKind: "hard",
      });
    }

    /* `seal` and `finalize` have no caller check in the contract — only status and time
       — and `AuctioneerSection` already offers both to anyone. The queue was gating them
       behind `isAuctioneer`, so a bidder waiting on a stalled auction was never told they
       could move it themselves. That is the whole point of the step being permissionless:
       nobody can hold an auction hostage by declining to seal it. */
    const stake = iBid || isAuctioneer;

    if (stake) {
      /* `seal` reverts before the bid deadline. Listing it from the moment the auction
         opened offered a button that could only fail for the whole bidding period. */
      if (a.status === Status.Open && a.bidDeadline > 0 && now >= a.bidDeadline) {
        out.push({
          kind: "seal", auctionId: id, role: isAuctioneer ? "auctioneer" : "bidder",
          title: `Seal Auction #${id}`,
          detail: "Freezes the bid set and stamps the block — before any seed can be sent, "
            + "so before anyone can read an amount. That ordering is what stops a bid being "
            + "dropped once its value is known.",
          consequence: "Bidding has closed but the set is not frozen, so no seed can be "
            + "sent and nothing can settle, and every bidder's escrow stays locked. "
            + "Sealing is permissionless — if the auctioneer does not do it, any bidder "
            + "can, which is what stops an auction being stalled by inaction.",
          cta: "Seal", href: manageHref, deadline: null, deadlineKind: "hard",
        });
      }
      /* `settle` *is* auctioneer-only — it is the one step with a caller check. */
      if (isAuctioneer && a.status === Status.Sealed) {
        out.push({
          kind: "settle", auctionId: id, role: "auctioneer",
          title: `Settle Auction #${id}`,
          detail: "Submits one witness per bid plus a second for the runner-up, proving the "
            + "clearing price without opening a single bid. It moves no money — it opens "
            + "the dispute window, and puts your bond at risk if the outcome is wrong.",
          consequence: "Past this, anyone can abandon the auction. It cancels, every bidder "
            + "is refunded, the lot returns to the seller, and your bond is split among the "
            + "bidders — so missing it costs you the bond and the sale together.",
          cta: "Settle", href: manageHref,
          /* The auctioneer's own clock, and it is enforced: `abandon` becomes callable
             at exactly this moment. It was showing as no deadline at all. */
          deadline: settleBy, deadlineKind: "hard",
        });
      }
      /* `finalize` reverts until the dispute window has closed. */
      if (a.status === Status.Settled && now >= a.disputeDeadline) {
        out.push({
          kind: "finalize", auctionId: id, role: isAuctioneer ? "auctioneer" : "bidder",
          title: `Finalize Auction #${id}`,
          detail: "The dispute window closed clean, so this releases the funds: the clearing "
            + "price and your bond to the seller, the lot to the winner.",
          consequence: "Nothing expires, but nobody is paid until someone does it — the "
            + "proceeds, the bond and the winner's lot all stay in the contract. This is "
            + "permissionless too, so a winner need not wait on the auctioneer.",
          cta: "Finalize", href: manageHref, deadline: null, deadlineKind: "hard",
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

/**
 * The sidebar badge sat on "My bids" but counted every action including the auctioneer's,
 * so an address with no bids at all could read "My bids 2". Splitting the count is what
 * lets a label mean what it says.
 */
export const bidderActions = (list: DueAction[]) => list.filter((a) => a.role === "bidder");
export const auctioneerActions = (list: DueAction[]) =>
  list.filter((a) => a.role === "auctioneer");
