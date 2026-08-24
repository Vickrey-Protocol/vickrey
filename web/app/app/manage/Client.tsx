"use client";

import Link from "next/link";
import { Status } from "@vickrey/client";
import { countdown, formatUnits, utcDate } from "@/lib/config";
import { sameAddress } from "@/lib/wallet";
import { STATUS } from "@/lib/ui";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { useNow, useWallet } from "@/components/WalletProvider";

/** The auctions this address is responsible for, and what each is waiting on. */
export default function Client() {
  const { connection } = useWallet();
  const now = useNow();
  const d = useDashData();
  const owned = d.auctions.filter(
    (a) => connection && sameAddress(connection.address, a.auctioneer));

  const waitingOn = (s: Status) =>
    s === Status.Open ? "bidding to close"
    : s === Status.Sealed ? "you to settle"
    : s === Status.Settled ? "the dispute window"
    : s === Status.Finalized ? "nothing — resolved"
    : "—";

  return (
    <DashShell title="Manage" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      {owned.length === 0 ? (
        <div className="panel">
          <p><b>You have not created an auction.</b></p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            Auctions you create appear here with their seal, settle and finalize steps.{" "}
            <Link href="/app/create">Create one</Link>.
          </p>
        </div>
      ) : (
        <div className="panel scroller">
          <table>
            <thead>
              <tr><th>#</th><th>Lot</th><th>State</th><th>Bids</th>
                  <th>Waiting on</th><th>Deadline</th><th></th></tr>
            </thead>
            <tbody>
              {owned.map((a) => {
                const when = a.status === Status.Open ? a.bidDeadline
                  : a.status === Status.Settled ? a.disputeDeadline : 0;
                return (
                  <tr key={a.terms.auctionId.toString()}>
                    <td className="mono">{a.terms.auctionId.toString()}</td>
                    <td>{formatUnits(a.lotAmount, a.lotDecimals)} {a.lotSymbol}</td>
                    <td><span className={`pill ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></td>
                    <td className="mono">{a.bidCount}</td>
                    <td className="note">{waitingOn(a.status)}</td>
                    <td>{when
                      ? <>{countdown(when, now) ?? "closed"}
                          <span className="note" style={{ display: "block" }}>{utcDate(when)}</span></>
                      : <span className="note">—</span>}</td>
                    <td><Link href={`/app/manage/${a.terms.auctionId}`}>Console →</Link></td>
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
