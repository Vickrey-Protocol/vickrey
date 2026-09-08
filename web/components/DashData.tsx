"use client";

import { useEffect, useMemo, useState } from "react";
import { Status } from "@vickrey/client";
import {
  findBidIndex, readAll, readBidCount, readBidState, type AuctionView, type BidState,
} from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import { reconcile } from "@/lib/reconcile";
import { allBids, dropBid, onVaultChange, reindexBid, type StoredBid } from "@/lib/vault";
import { startVaultSync } from "@/lib/vaultSync";
import { sameAddress } from "@/lib/wallet";
import { actionsFor, type DueAction } from "@/lib/actions";
import { useWallet } from "@/components/WalletProvider";

/**
 * One chain read, shared by every dashboard route.
 *
 * The sidebar badge, the topbar counter and the Overview all need the same answer to
 * "what needs you". Reading it per component would let them disagree, which on a screen
 * whose whole job is "you will lose money if you miss this" is worse than showing
 * nothing.
 */
export interface DashData {
  auctions: AuctionView[];
  mine: StoredBid[];
  /** On-chain state for this browser's own bids, keyed `auctionId:index`. */
  bidStates: Map<string, BidState>;
  actions: DueAction[];
  ownsAuctions: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashData(): DashData {
  const { connection } = useWallet();
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [mine, setMine] = useState<StoredBid[]>([]);
  const [bidStates, setBidStates] = useState<Map<string, BidState>>(new Map());
  const [loading, setLoading] = useState(true);
  /**
   * Everything an action can come from, and whether it has arrived.
   *
   * `loading` used to mean "the chain read finished", and the queue rendered the moment
   * it did — but this browser's own bids are read in a *later* effect, and per-bid
   * on-chain state in a later one still. So there was a render with auctions loaded and
   * `mine` still empty, which derives to no actions, which draws "Nothing needs you
   * right now" for a beat before the real queue replaced it.
   *
   * Announcing an empty result before the inputs are in is the same mistake as reading a
   * discovery store too early: absence of data is not the answer "none".
   */
  const [vaultRead, setVaultRead] = useState(false);
  const [statesRead, setStatesRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isDeployed()) { setLoading(false); return; }
    let live = true;
    (async () => {
      try {
        const a = await readAll();
        if (!live) return;
        setAuctions(a);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [tick]);

  useEffect(() => { setMine(allBids()); setVaultRead(true); }, [tick, auctions.length]);
  /* Another tab writing the vault is a change to `mine` here too — and the sync that
     undoes an old tab's wipe has to be running wherever the reconciler runs. */
  useEffect(() => { startVaultSync(); return onVaultChange(() => setMine(allBids())); }, []);

  /**
   * Reconcile this browser's vault against the chain, once the auctions are in.
   *
   * Two things put a stored bid out of step with reality. A transaction that reverted
   * still left its entry behind, because the write happens before the send and nothing
   * undid it — that is where a claim row for a bid the chain never assigned comes from.
   * And the index was taken from a polled `bidCount`, so anyone bidding in the gap
   * between the poll and the send shifted it.
   *
   * Both are corrected here rather than needing a manual purge: a commitment found at a
   * different index is renumbered, and one found nowhere in an auction that *was* read
   * successfully is dropped.
   *
   * The asymmetry is deliberate. Renumbering is safe. Dropping destroys a secret, so it
   * happens only when the chain positively answered "no bid here carries this
   * commitment" — never on a failed read, and never for an auction we could not load.
   */
  useEffect(() => {
    if (!auctions.length || !mine.length) return;
    let live = true;
    void (async () => {
      for (const b of mine) {
        const a = auctions.find((x) => x.terms.auctionId === BigInt(b.auctionId));
        if (!a || !live) continue;
        try {
          const here = b.index < a.bidCount
            ? await readBidState(a.terms.auctionId, b.index)
            : null;
          if (here && here.claimCommitment === BigInt(b.claimCommitment)) continue;

          /*
            The bound is read from the chain here, never taken from `a`.

            `a.bidCount` is a poll, and in the moment that matters most — just after a bid
            — it is short by exactly that bid. The stored index then equals the stale
            count, so the `readBidState` above is skipped, the search below covers only
            0..count-1 and cannot reach the new bid, and the `null` it returns means "the
            range excluded it", not "no bid carries this commitment". Dropping on that
            deleted the claim secret for a bid that had just landed, on the dashboard the
            bidder opened to look at it.
          */
          const count = await readBidCount(a.terms.auctionId);
          if (!live) return;
          const found = await findBidIndex(
            a.terms.auctionId, count, BigInt(b.claimCommitment));
          if (!live) return;
          const verdict = reconcile(
            { storedIndex: b.index, chainCount: count, foundIndex: found });
          if (verdict.do === "reindex") reindexBid(a.terms.auctionId, b.index, verdict.to);

          /*
            Rule 11 on the other edge. A count that does not yet reach the stored index
            means the chain has not caught up with this bid — not evidence against it.
            Only a search that actually covered the index is a negative answer.

            A bid that truly never landed keeps its entry until somebody else bids and the
            count passes it, at which point the search is conclusive and it is cleaned up.
            A stale row costs nothing; a deleted seed costs the escrow behind it.
          */
          if (verdict.do === "drop") dropBid(a.terms.auctionId, b.index);
        } catch {
          /* Unreadable chain. Absence of an answer is not "this bid does not exist", so
             nothing is dropped and the next poll tries again. */
        }
      }
      if (live) setMine(allBids());
    })();
    return () => { live = false; };
  }, [auctions, mine.length]);

  /* Whether a bid has been collected is not in `AuctionView` — it is per-bid, and the
     queue needs it. Without it a winner who claimed the lot was told nothing more, and
     their surplus sat in the contract unmentioned: `finalize` had already taken the
     clearing price out of that escrow, so what remains is theirs.

     Only for finished auctions this browser holds bids in, so it is a handful of reads. */
  useEffect(() => {
    const done: Status[] = [Status.Finalized, Status.Cancelled];
    const wanted = mine.filter((b) =>
      auctions.some((a) => a.terms.auctionId === BigInt(b.auctionId) && done.includes(a.status)));
    /* Nothing to fetch is an answer, not a pending state — otherwise the queue would
       wait forever for reads it is never going to make. */
    if (!wanted.length) { setStatesRead(true); return; }
    let live = true;
    void Promise.all(wanted.map(async (b) => {
      try {
        const st = await readBidState(BigInt(b.auctionId), b.index);
        return [`${b.auctionId}:${b.index}`, st] as const;
      } catch { return null; }
    })).then((rows) => {
      if (!live) return;
      setBidStates(new Map(rows.filter(Boolean) as Array<readonly [string, BidState]>));
      setStatesRead(true);
    });
    return () => { live = false; };
  }, [mine, auctions, tick]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  /* `tick` is in the deps so the queue re-derives as the clock advances: `abandon` only
     appears once a grace period has actually expired, and a memo frozen at mount would
     never show it. */
  const actions = useMemo(
    () => actionsFor(auctions, mine, connection?.address ?? null,
                     Math.floor(Date.now() / 1000), bidStates),
    [auctions, mine, connection?.address, tick, bidStates],
  );
  /* Sellers too, not only auctioneers. A seller can seal, finalize and abandon their own
     auction — all three live on the manage page — and gating the link on `auctioneer`
     hid the page from the person whose lot is inside it. */
  const ownsAuctions = useMemo(
    () => !!connection && auctions.some((a) =>
      sameAddress(connection.address, a.auctioneer) || sameAddress(connection.address, a.seller)),
    [auctions, connection],
  );

  return {
    auctions, mine, bidStates, actions, ownsAuctions, error,
    /* True until every source of an action has reported. The queue must not say "nothing"
       on the strength of a partial read. */
    loading: loading || !vaultRead || !statesRead,
    refresh: () => setTick((n) => n + 1),
  };
}
