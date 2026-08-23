"use client";

import { useState } from "react";
import {
  planSettlement,
  Status,
  verifyPlan,
  type PublicBid,
  type Reveal,
  type SettlementPlan,
} from "@vickrey/client";
import { settleCalldata, type AuctionView } from "@/lib/chain";
import { config, formatUnits } from "@/lib/config";
import type { Connection } from "@/lib/wallet";

/**
 * The auctioneer's console. It can only produce an outcome it can prove: a reveal that
 * does not reconstruct the on-chain anchors is forfeited, never taken on trust.
 */
export function SettlePanel({
  auction,
  bids,
  connection,
}: {
  auction: AuctionView;
  bids: PublicBid[];
  connection: Connection | null;
}) {
  const [plan, setPlan] = useState<SettlementPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auction.status !== Status.Sealed) return null;

  async function build() {
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/reveals?auctionId=${auction.terms.auctionId}`);
      const { reveals } = (await res.json()) as {
        reveals: Array<{ index: number; seed: string; level: number }>;
      };
      const parsed: Reveal[] = reveals.map((r) => ({
        index: r.index,
        seed: BigInt(r.seed),
        level: r.level,
      }));
      const next = planSettlement(auction.terms, bids, parsed);
      setPlan(next);
      setProblems(verifyPlan(auction.terms, bids, next));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit() {
    if (!connection || !plan) return;
    setErr(null);
    try {
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "settle",
        calldata: settleCalldata(
          auction.terms.auctionId,
          plan.clearingLevel,
          plan.winnerIndex,
          plan.proofs,
        ),
      });
      setMsg(`Submitted: ${res.transaction_hash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Settle</h3>
      <p className="small muted">
        Builds the {bids.length + 1} witnesses the contract checks. Only the clearing
        price and the winning index reach the chain; every other bid is proved to sit at
        or below the price without being opened.
      </p>
      <div className="row">
        <button onClick={build}>Collect reveals and rank</button>
        {plan && (
          <button
            className="primary"
            onClick={submit}
            disabled={problems.length > 0 || !connection}
          >
            Submit the proof
          </button>
        )}
      </div>

      {plan && (
        <>
          <div className="grid2" style={{ marginTop: "1rem" }}>
            <div>
              <label>Clearing price</label>
              <div className="mono">{formatUnits(plan.clearingPrice)}</div>
            </div>
            <div>
              <label>Winning bid</label>
              <div className="mono">#{plan.winnerIndex}</div>
            </div>
            <div>
              <label>Forfeited</label>
              <div className="mono">
                {plan.forfeited.length === 0 ? "none" : plan.forfeited.join(", ")}
              </div>
            </div>
          </div>
          {problems.length > 0 ? (
            <ul className="small err">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="small ok">
              Every witness verifies locally. The contract will check the same things.
            </p>
          )}
        </>
      )}
      {msg && <p className="small ok">{msg}</p>}
      {err && <p className="small err">{err}</p>}
    </div>
  );
}

/** Sealing is permissionless on purpose: the auctioneer must not be able to stall it. */
export function SealPanel({
  auction,
  connection,
  now,
}: {
  auction: AuctionView;
  connection: Connection | null;
  now: number;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auction.status !== Status.Open) return null;
  const ready = now >= auction.bidDeadline;

  async function seal() {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null);
    try {
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "seal",
        calldata: [auction.terms.auctionId.toString()],
      });
      setMsg(`Submitted: ${res.transaction_hash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Seal</h3>
      <p className="small muted">
        Freezes the bid set and stamps the block. Anyone can call it — if only the
        auctioneer could, it could stall until the book suited it.
      </p>
      <button onClick={seal} disabled={!ready || !connection}>
        {ready ? "Seal the auction" : "Bidding is still open"}
      </button>
      {msg && <p className="small ok">{msg}</p>}
      {err && <p className="small err">{err}</p>}
    </div>
  );
}

/** Releases the funds, once the dispute window has closed clean. */
export function FinalizePanel({
  auction,
  connection,
  now,
}: {
  auction: AuctionView;
  connection: Connection | null;
  now: number;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auction.status !== Status.Settled) return null;
  const ready = now >= auction.disputeDeadline;

  async function finalize() {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null);
    try {
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "finalize",
        calldata: [auction.terms.auctionId.toString()],
      });
      setMsg(`Submitted: ${res.transaction_hash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Finalize</h3>
      <p className="small muted">
        Nothing has moved yet. The dispute window closes at{" "}
        {new Date(auction.disputeDeadline * 1000).toLocaleString()}, and only then do
        funds change hands.
      </p>
      <button className="primary" onClick={finalize} disabled={!ready || !connection}>
        {ready ? "Release the funds" : "Dispute window still open"}
      </button>
      {msg && <p className="small ok">{msg}</p>}
      {err && <p className="small err">{err}</p>}
    </div>
  );
}
