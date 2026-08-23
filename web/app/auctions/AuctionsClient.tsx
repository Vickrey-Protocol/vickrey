"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Status } from "@vickrey/client";
import { fromWire, readAll, type AuctionView, type WireAuction } from "@/lib/chain";
import { config, explorerContract, isDeployed } from "@/lib/config";
import { PublicShell } from "@/components/PublicShell";
import { AuctionCard } from "@/components/AuctionCard";
import { useNow } from "@/components/WalletProvider";


type Filter = "all" | "open" | "settled";

export default function AuctionsClient({ initial }: { initial: WireAuction[] }) {
  const router = useRouter();
  const now = useNow();
  const [all, setAll] = useState<AuctionView[]>(() => initial.map(fromWire));
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try { setAll(await readAll()); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => all.filter((a) =>
    filter === "all" ? true
    : filter === "open" ? a.status === Status.Open
    : a.status === Status.Settled || a.status === Status.Finalized), [all, filter]);

  return (
    <PublicShell>
      <div className="spread" style={{ marginBottom: ".9rem" }}>
        <h1 className="display" style={{ fontSize: "var(--step-3)", margin: 0 }}>Auctions</h1>
        <a className="note mono" href={explorerContract(config.auctionAddress)}
           target="_blank" rel="noreferrer">contract ↗</a>
      </div>
      <p style={{ maxWidth: "60ch", marginBottom: "1.2rem" }}>
        Every auction on {config.label}, in every state. No wallet needed to read any of
        it — the bid amounts are not hidden from you, they are not on the chain at all.
      </p>

      <div className="row" style={{ gap: ".5rem", marginBottom: "1.2rem" }}>
        {(["all", "open", "settled"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter === f ? "primary" : ""}>
            {f === "all" ? "All" : f === "open" ? "Taking bids" : "Settled"}
            <span className="note" style={{ marginLeft: ".4rem" }}>
              {f === "all" ? all.length
                : f === "open" ? all.filter((a) => a.status === Status.Open).length
                : all.filter((a) => a.status === Status.Settled || a.status === Status.Finalized).length}
            </span>
          </button>
        ))}
      </div>

      {/* Four states, all designed. An empty list is a sentence, not a blank. */}
      {!isDeployed() ? (
        <div className="banner">
          <b>No contract configured for {config.label}.</b> Set{" "}
          <span className="mono">NEXT_PUBLIC_AUCTION_ADDRESS</span>. The README carries the
          honest status of every piece.
        </div>
      ) : error && all.length === 0 ? (
        <div className="banner">
          <b>Could not read {config.label}.</b> {error}
          <div style={{ marginTop: ".6rem" }}>
            <button onClick={() => location.reload()}>Try again</button>
          </div>
        </div>
      ) : all.length === 0 ? (
        <div className="banner">
          <b>No auctions yet</b> on {config.label}. Nothing has been created against this
          contract. When one is, it appears here without a wallet.
        </div>
      ) : shown.length === 0 ? (
        <div className="banner">
          <b>Nothing {filter === "open" ? "taking bids" : "settled"} right now.</b>{" "}
          <button onClick={() => setFilter("all")}>Show all {all.length}</button>
        </div>
      ) : (
        <div className="cards" data-reveal>
          {shown.map((a) => (
            <AuctionCard
              key={a.terms.auctionId.toString()}
              auction={a} now={now} selected={false}
              onSelect={() => router.push(`/auction/${a.terms.auctionId}`)}
            />
          ))}
        </div>
      )}
    </PublicShell>
  );
}
