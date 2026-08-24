"use client";

import Link from "next/link";
import { Status } from "@vickrey/client";
import { countdown, formatUnits, utcDate } from "@/lib/config";
import { isUrgent, type DueAction } from "@/lib/actions";
import { sameAddress } from "@/lib/wallet";
import { STATUS } from "@/lib/ui";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { useNow, useWallet } from "@/components/WalletProvider";

function ActionCard({ a, now }: { a: DueAction; now: number }) {
  const urgent = isUrgent(a, now);
  const left = a.deadline === null ? null : countdown(a.deadline, now);
  return (
    <div className={`act${urgent ? " act-urgent" : ""}`}>
      <div className="act-main">
        <p className="act-title">{a.title}</p>
        <p className="note">{a.detail}</p>
      </div>
      <div className="act-when">
        {/* R4: countdown and absolute UTC, both, always. A countdown alone cannot be
            quoted in a dispute and a timestamp alone does not convey urgency. */}
        {a.deadline === null ? (
          <span className="note">No deadline</span>
        ) : (
          <>
            <span className={urgent ? "countdown urgent" : "countdown"}>{left ?? "closed"}</span>
            <span className="note">{utcDate(a.deadline)}</span>
          </>
        )}
      </div>
      <Link className="primary" href={a.href}>{a.cta}</Link>
    </div>
  );
}

export default function OverviewClient() {
  const { connection } = useWallet();
  const now = useNow();
  const d = useDashData();

  const nextDeadline = d.auctions
    .flatMap((a) => [a.bidDeadline, a.disputeDeadline].filter((t) => t > now))
    .sort((x, y) => x - y)[0];

  const positions = d.auctions.filter((a) =>
    d.mine.some((b) => BigInt(b.auctionId) === a.terms.auctionId) ||
    (connection && sameAddress(connection.address, a.auctioneer)));

  return (
    <DashShell title="Overview" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      {/* ── Band 1 ─────────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="section" style={{ marginTop: 0 }}>Action required</h2>
        {d.loading ? (
          /* A skeleton shaped like the content, never a spinner where a number goes. */
          <div className="stack">
            {[0, 1].map((i) => <div key={i} className="act skel" aria-hidden="true" />)}
          </div>
        ) : d.error ? (
          <div className="banner">
            <b>Could not read the chain.</b> {d.error}
            <div style={{ marginTop: ".6rem" }}><button onClick={d.refresh}>Try again</button></div>
          </div>
        ) : d.actions.length === 0 ? (
          <div className="panel">
            <p><b>Nothing needs you right now.</b></p>
            <p className="note" style={{ marginTop: ".4rem" }}>
              {nextDeadline
                ? <>Next deadline on an auction you can see is {countdown(nextDeadline, now)} — {utcDate(nextDeadline)}.</>
                : <>No deadlines are running. New auctions appear on <Link href="/app/auctions">Auctions</Link>.</>}
            </p>
          </div>
        ) : (
          <div className="stack">
            {d.actions.map((a) => <ActionCard key={`${a.kind}-${a.auctionId}`} a={a} now={now} />)}
          </div>
        )}
      </section>

      {/* ── Band 2 ─────────────────────────────────────────────────────────────── */}
      <section style={{ marginTop: "2.4rem" }}>
        <h2 className="section" style={{ marginTop: 0 }}>Your positions</h2>
        {positions.length === 0 ? (
          <div className="panel">
            <p><b>You have no positions.</b></p>
            <p className="note" style={{ marginTop: ".4rem" }}>
              Bids you place and auctions you create appear here.{" "}
              <Link href="/app/auctions">Find an auction</Link> or{" "}
              <Link href="/app/create">create one</Link>.
            </p>
          </div>
        ) : (
          <div className="panel scroller">
            <table>
              <thead>
                <tr><th>Auction</th><th>Role</th><th>State</th><th>Your level</th>
                    <th>Escrow</th><th></th></tr>
              </thead>
              <tbody>
                {positions.map((a) => {
                  const bids = d.mine.filter((b) => BigInt(b.auctionId) === a.terms.auctionId);
                  const isAuc = connection && sameAddress(connection.address, a.auctioneer);
                  return (
                    <tr key={a.terms.auctionId.toString()}>
                      <td className="mono">#{a.terms.auctionId.toString()}</td>
                      <td>{bids.length && isAuc ? "both" : bids.length ? "bidder" : "auctioneer"}</td>
                      <td><span className={`pill ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></td>
                      {/* Your own level, from your own browser — never an amount, and
                          marked as local so it is not mistaken for something on-chain. */}
                      <td>{bids.length
                        ? <span className="local">{bids.map((b) => b.level).join(", ")}</span>
                        : <span className="undisclosed">—</span>}</td>
                      <td>{bids.length
                        ? `${formatUnits(a.collateral * BigInt(bids.length), a.paymentDecimals)} ${a.paymentSymbol}`
                        : <span className="undisclosed">—</span>}</td>
                      <td><Link href={isAuc ? `/app/manage/${a.terms.auctionId}` : `/auction/${a.terms.auctionId}`}>
                        Open →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note" style={{ marginTop: ".8rem" }}>
              <b>Your level</b> is read from this browser, not the chain. It is the rung
              you picked, not a price, and nobody else can see it — including us.
            </p>
          </div>
        )}
      </section>

      {/* ── Band 3 ─────────────────────────────────────────────────────────────── */}
      <section style={{ marginTop: "2.4rem" }}>
        <h2 className="section" style={{ marginTop: 0 }}>Protocol</h2>
        <dl className="hero-stats">
          <div><dt>Auctions</dt><dd>{d.auctions.length}</dd></div>
          <div><dt>Bids sealed</dt><dd>{d.auctions.reduce((n, a) => n + a.bidCount, 0)}</dd></div>
          <div><dt>Amounts disclosed</dt><dd className="zero">0</dd></div>
        </dl>
      </section>
    </DashShell>
  );
}
