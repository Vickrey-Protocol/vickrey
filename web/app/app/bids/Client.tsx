"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Status } from "@vickrey/client";
import { formatUnits } from "@/lib/config";
import {
  exportBids, exportStatus, importBids, markExported,
  type ExportStatus, type StoredBid,
} from "@/lib/vault";
import { STATUS } from "@/lib/ui";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";

type Filter = "all" | "live" | "actionable";

/**
 * How current the backup is, said three ways because there are three of them.
 *
 * A boolean would only distinguish "exported" from "not", and the state that actually
 * costs money is the third one: exported once, bid again, believed covered. That is why
 * the vault records the *set* it exported rather than a flag.
 *
 * None of this survives clearing site data — it lives in the same storage as the secrets
 * it describes, and every origin-scoped store goes in the same sweep. Nothing can change
 * that without a server, and a server that knew you held bids could link you to
 * auctions. So this is phrased as a statement about what is in this browser right now,
 * never as a guarantee that anything is safe.
 */
function backupLine(st: ExportStatus): { text: string; tone: "warn" | "ok" } | null {
  if (st.held === 0) return null;
  if (st.lastExport === null) return { text: "Never exported", tone: "warn" };
  const when = new Date(st.lastExport).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
  if (st.unbacked > 0) {
    return {
      text: `${st.unbacked} added since your export of ${when}`,
      tone: "warn",
    };
  }
  return { text: `Exported ${when} — up to date`, tone: "ok" };
}

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
  const [backup, setBackup] = useState<ExportStatus>(
    () => ({ held: 0, lastExport: null, unbacked: 0 }),
  );

  /* Read after mount, never during render: `localStorage` does not exist on the server
     and seeding from it would mismatch the first paint. */
  useEffect(() => { setBackup(exportStatus()); }, [d.mine]);

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
    markExported();
    setBackup(exportStatus());
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(exportBids());
    setCopied(true);
    // A copy is a backup too — it left the browser by the same door.
    markExported();
    setBackup(exportStatus());
  };

  const onImport = async (file: File) => {
    try { importBids(await file.text()); setImportMsg("Imported. Refreshing…"); d.refresh(); }
    catch (e) { setImportMsg(`Could not import: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const line = backupLine(backup);

  return (
    <DashShell title="My bids" actions={d.actions} ownsAuctions={d.ownsAuctions}>
      {/*
        This is the only thing on the dashboard that is unrecoverable if lost, and it read
        as an ordinary paragraph — so nobody exported. The weight is carried by the design
        rather than by adjectives: its own register, the count as the largest figure on the
        page, the backup state stated as a fact, and exactly one obvious next action.
      */}
      <section className="vault">
        <div className="vault-head">
          <p className="eyebrow">Claim secrets</p>
          <p className="vault-count">
            <b>{backup.held}</b>
            <span>held in this browser</span>
          </p>
          {line && <p className={`vault-state ${line.tone}`}>{line.text}</p>}
        </div>

        <div className="vault-body">
          <p className="vault-say">
            A claim secret is the only thing that releases its escrow. Not on the chain,
            not on a server, not recoverable by us — the same property that keeps the bid
            sealed keeps it unrecoverable.
          </p>

          <div className="vault-do">
            <button className="primary vault-export" onClick={download}
                    disabled={backup.held === 0}>
              Export to file
            </button>
            <div className="vault-alt">
              <button onClick={() => void copyAll()} disabled={backup.held === 0}>
                {copied ? "Copied" : "Copy as text"}
              </button>
              <label className="vault-import">
                Import…
                <input type="file" accept="application/json" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); }} />
              </label>
            </div>
          </div>

          <p className="note vault-foot">
            Keep the file where you would keep a key. Clearing site data, switching
            browser or using a private window ends this list — and this record of it.
          </p>
          {importMsg && <p className="note">{importMsg}</p>}
        </div>
      </section>

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
            Bids appear here with their secrets once you place one.{" "}
            <Link href="/app/auctions">Find an auction</Link>.
          </p>
          {/* The list and the sidebar can look like they disagree. They do not: one reads
              this browser, the other reads the chain, and the chain does not record who
              bid. Saying so is the fix — there is no number to correct. */}
          <p className="note" style={{ marginTop: ".6rem" }}>
            <b>Bid somewhere else?</b> A bid carries no address on chain — that is what
            keeps it sealed — so nothing here can find one for you, and no count anywhere
            in this app is a count of your bids. Importing the file you exported from that
            browser is the only way back to them.
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
