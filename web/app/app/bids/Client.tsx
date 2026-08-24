"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Status } from "@vickrey/client";
import { formatUnits } from "@/lib/config";
import { exportBids, importBids, type StoredBid } from "@/lib/vault";
import { STATUS } from "@/lib/ui";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";

type Filter = "all" | "live" | "actionable";

/**
 * Your bids, and the secrets that open them.
 *
 * The claim secret is the only thing that can release a bid's escrow. It exists in this
 * browser's local storage and nowhere else — not on the chain, not on a server, not with
 * us. That is the privacy property working as designed, and it is also a way to lose
 * money by clearing site data. This screen exists so that fact is somewhere a user can
 * find it *before* it matters, rather than only in the interruption at bid time.
 */
export default function Client() {
  const d = useDashData();
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const rows = useMemo(() => d.mine.map((b) => {
    const auction = d.auctions.find((a) => a.terms.auctionId === BigInt(b.auctionId)) ?? null;
    return { bid: b, auction };
  }), [d.mine, d.auctions]);

  const shown = rows.filter(({ auction }) =>
    filter === "all" ? true
    : filter === "live" ? auction && auction.status !== Status.Finalized && auction.status !== Status.Cancelled
    : d.actions.some((x) => auction && x.auctionId === auction.terms.auctionId));

  const download = () => {
    const blob = new Blob([exportBids()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vickrey-bids-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    try { importBids(await file.text()); setImportMsg("Imported. Refreshing…"); d.refresh(); }
    catch (e) { setImportMsg(`Could not import: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <DashShell title="My bids" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      {/* The warning comes first, because it is the thing that costs money. */}
      <div className="panel accent">
        <p className="eyebrow">Claim secrets</p>
        <p style={{ marginTop: ".5rem" }}>
          <b>Your claim secrets live in this browser and nowhere else.</b> They are what
          release your escrow. They are not on the chain, not on a server, and not
          recoverable by us or by anyone — that is the same property that keeps your bid
          sealed.
        </p>
        <p className="note" style={{ marginTop: ".5rem" }}>
          Clearing site data, switching browser, or using a private window loses them, and
          with them the refund. Export a copy and keep it somewhere you would keep a key.
        </p>
        <div className="row" style={{ gap: ".6rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <button className="primary" onClick={download} disabled={d.mine.length === 0}>
            Export {d.mine.length} secret{d.mine.length === 1 ? "" : "s"} to file
          </button>
          <button onClick={() => { void navigator.clipboard.writeText(exportBids()); setCopied(true); }}
                  disabled={d.mine.length === 0}>
            {copied ? "Copied" : "Copy as text"}
          </button>
          <label className="chip" style={{ cursor: "pointer" }}>
            Import…
            <input type="file" accept="application/json" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); }} />
          </label>
        </div>
        {importMsg && <p className="note" style={{ marginTop: ".6rem" }}>{importMsg}</p>}
      </div>

      <div className="row" style={{ gap: ".5rem", margin: "1.6rem 0 1rem" }}>
        {(["all", "live", "actionable"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "primary" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "live" ? "Live" : "Needs me"}
          </button>
        ))}
      </div>

      {d.mine.length === 0 ? (
        <div className="panel">
          <p><b>You have not placed a bid from this browser.</b></p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            Bids are listed here with their secrets once you place one.{" "}
            <Link href="/app/auctions">Find an auction</Link>. If you bid from another
            browser, import the secrets you exported there.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <p><b>Nothing matches that filter.</b></p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            <button onClick={() => setFilter("all")}>Show all {d.mine.length}</button>
          </p>
        </div>
      ) : (
        <div className="panel scroller">
          <table>
            <thead>
              <tr><th>Auction</th><th>Your level</th><th>State</th><th>Escrow</th>
                  <th>Seed sent</th><th>Secret</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map(({ bid, auction }) => (
                <tr key={`${bid.auctionId}-${bid.index}`}>
                  <td className="mono">#{bid.auctionId}</td>
                  {/* Their own rung, from their own browser. Never a currency figure. */}
                  <td><span className="local">level {bid.level}</span></td>
                  <td>{auction
                    ? <span className={`pill ${STATUS[auction.status].cls}`}>{STATUS[auction.status].label}</span>
                    : <span className="note">not found on chain</span>}</td>
                  <td>{auction
                    ? `${formatUnits(auction.collateral, auction.paymentDecimals)} ${auction.paymentSymbol}`
                    : <span className="undisclosed">—</span>}</td>
                  <td>{bid.revealedAt ? "yes" : <span className="undisclosed">not yet</span>}</td>
                  <td>{bid.claimSecret
                    ? <span className="note">held</span>
                    : <span className="err">MISSING — refund unrecoverable</span>}</td>
                  <td><Link href={`/auction/${bid.auctionId}`}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: ".8rem" }}>
            <b>Your level</b> is the rung you chose, read from this browser. It is not a
            price and it is not on the chain — nobody else can see it.
          </p>
        </div>
      )}
    </DashShell>
  );
}
