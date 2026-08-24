"use client";

import Link from "next/link";
import { Status } from "@vickrey/client";
import { countdown, formatUnits, utcDate } from "@/lib/config";
import { sameAddress } from "@/lib/wallet";
import { STATUS } from "@/lib/ui";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { useNow, useWallet } from "@/components/WalletProvider";

/** The same book as the public list, with the one column a wallet adds: your position. */
export default function Client() {
  const { connection } = useWallet();
  const now = useNow();
  const d = useDashData();

  return (
    <DashShell title="Auctions" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      {d.loading ? (
        <div className="panel skel" style={{ blockSize: "12rem" }} aria-hidden="true" />
      ) : d.error ? (
        <div className="banner">
          <b>Could not read the chain.</b> {d.error}
          <div style={{ marginTop: ".6rem" }}><button onClick={d.refresh}>Try again</button></div>
        </div>
      ) : d.auctions.length === 0 ? (
        <div className="panel">
          <p><b>No auctions exist yet.</b></p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            Nothing has been created against this contract.{" "}
            <Link href="/app/create">Create the first one</Link>.
          </p>
        </div>
      ) : (
        <div className="panel scroller">
          <table>
            <thead>
              <tr><th>#</th><th>Lot</th><th>State</th><th>Bids</th><th>Escrow</th>
                  <th>Next deadline</th><th>You</th><th></th></tr>
            </thead>
            <tbody>
              {d.auctions.map((a) => {
                const mine = d.mine.filter((b) => BigInt(b.auctionId) === a.terms.auctionId);
                const isAuc = connection && sameAddress(connection.address, a.auctioneer);
                const when = a.status === Status.Open ? a.bidDeadline
                  : a.status === Status.Settled ? a.disputeDeadline : 0;
                return (
                  <tr key={a.terms.auctionId.toString()}>
                    <td className="mono">{a.terms.auctionId.toString()}</td>
                    <td>{formatUnits(a.lotAmount, a.lotDecimals)} {a.lotSymbol}</td>
                    <td><span className={`pill ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></td>
                    <td className="mono">{a.bidCount}</td>
                    <td>{formatUnits(a.collateral, a.paymentDecimals)} {a.paymentSymbol}</td>
                    <td>{when
                      ? <>{countdown(when, now) ?? "closed"}
                          <span className="note" style={{ display: "block" }}>{utcDate(when)}</span></>
                      : <span className="note">—</span>}</td>
                    <td>{isAuc && mine.length ? "both" : isAuc ? "auctioneer"
                      : mine.length ? `${mine.length} bid${mine.length > 1 ? "s" : ""}`
                      : <span className="note">—</span>}</td>
                    <td><Link href={isAuc ? `/app/manage/${a.terms.auctionId}` : `/auction/${a.terms.auctionId}`}>
                      Open →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashShell>
  );
}
