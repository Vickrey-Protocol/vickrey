"use client";

import { useEffect, useMemo, useState } from "react";
import { Status } from "@vickrey/client";
import { readAll, readBidState, type AuctionView, type BidState } from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import { allBids, type StoredBid } from "@/lib/vault";
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

  useEffect(() => { setMine(allBids()); }, [tick, auctions.length]);

  /* Whether a bid has been collected is not in `AuctionView` — it is per-bid, and the
     queue needs it. Without it a winner who claimed the lot was told nothing more, and
     their surplus sat in the contract unmentioned: `finalize` had already taken the
     clearing price out of that escrow, so what remains is theirs.

     Only for finished auctions this browser holds bids in, so it is a handful of reads. */
  useEffect(() => {
    const done: Status[] = [Status.Finalized, Status.Cancelled];
    const wanted = mine.filter((b) =>
      auctions.some((a) => a.terms.auctionId === BigInt(b.auctionId) && done.includes(a.status)));
    if (!wanted.length) return;
    let live = true;
    void Promise.all(wanted.map(async (b) => {
      try {
        const st = await readBidState(BigInt(b.auctionId), b.index);
        return [`${b.auctionId}:${b.index}`, st] as const;
      } catch { return null; }
    })).then((rows) => {
      if (!live) return;
      setBidStates(new Map(rows.filter(Boolean) as Array<readonly [string, BidState]>));
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
  const ownsAuctions = useMemo(
    () => !!connection && auctions.some((a) => sameAddress(connection.address, a.auctioneer)),
    [auctions, connection],
  );

  return {
    auctions, mine, bidStates, actions, ownsAuctions, loading, error,
    refresh: () => setTick((n) => n + 1),
  };
}
