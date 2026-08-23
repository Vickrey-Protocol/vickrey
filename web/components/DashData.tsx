"use client";

import { useEffect, useMemo, useState } from "react";
import { readAll, type AuctionView } from "@/lib/chain";
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

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const actions = useMemo(
    () => actionsFor(auctions, mine, connection?.address ?? null),
    [auctions, mine, connection?.address],
  );
  const ownsAuctions = useMemo(
    () => !!connection && auctions.some((a) => sameAddress(connection.address, a.auctioneer)),
    [auctions, connection],
  );

  return {
    auctions, mine, actions, ownsAuctions, loading, error,
    refresh: () => setTick((n) => n + 1),
  };
}
