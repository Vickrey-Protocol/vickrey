"use client";

import { useState } from "react";
import {
  planSettlement,
  type PublicBid,
  type Reveal,
  type SettlementPlan,
  Status,
  verifyPlan,
} from "@vickrey/client";
import { settleCalldata, type AuctionView } from "@/lib/chain";
import { config, countdown, formatUnits, utcDate } from "@/lib/config";
import type { Connection } from "@/lib/wallet";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The auctioneer's controls, as a section of the one page rather than a separate
 * route. It appears only for the auctioneer's address — except `seal` and
 * `finalize`, which are permissionless by design and are offered to anyone, because
 * an auctioneer who could stall them could wait for a book that suited it.
 */
export function AuctioneerSection({
  auction,
  bids,
  connection,
  now,
  isAuctioneer,
}: {
  auction: AuctionView;
  bids: PublicBid[];
  connection: Connection | null;
  now: number;
  isAuctioneer: boolean;
}) {
  const [plan, setPlan] = useState<SettlementPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const canSeal = auction.status === Status.Open && now >= auction.bidDeadline;
  const canFinalize = auction.status === Status.Settled && now >= auction.disputeDeadline;
  const canSettle = isAuctioneer && auction.status === Status.Sealed;
  if (!canSeal && !canFinalize && !canSettle) return null;

  async function invoke(entrypoint: string, calldata: string[]) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setMsg(null);
    try {
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress, entrypoint, calldata,
      });
      setMsg(res.transaction_hash);
    } catch (e) {
      setErr(errText(e));
    }
  }

  /**
   * Collects reveals from the relay and from anything pasted in by hand, then ranks.
   *
   * Both sources are equally untrusted: `planSettlement` reconstructs each bid's
   * published anchors from the seed and discards anything that does not match. A
   * forged or corrupted reveal forfeits that bid rather than being believed.
   */
  async function build() {
    setErr(null); setMsg(null);
    try {
      const collected = new Map<number, Reveal>();

      try {
        const res = await fetch(`/api/reveals?auctionId=${auction.terms.auctionId}`);
        const { reveals } = (await res.json()) as {
          reveals: Array<{ index: number; seed: string; level: number }>;
        };
        for (const r of reveals) {
          collected.set(r.index, { index: r.index, seed: BigInt(r.seed), level: r.level });
        }
      } catch {
        // The relay is a convenience. Pasted reveals alone are enough.
      }

      if (pasted.trim()) {
        const raw = JSON.parse(pasted) as
          | Array<{ index: number; seed: string; level: number }>
          | { index: number; seed: string; level: number };
        for (const r of Array.isArray(raw) ? raw : [raw]) {
          collected.set(r.index, { index: r.index, seed: BigInt(r.seed), level: r.level });
        }
      }

      const next = planSettlement(auction.terms, bids, [...collected.values()]);
      setPlan(next);
      setProblems(verifyPlan(auction.terms, bids, next));
      setMsg(`${collected.size} reveal(s) collected, ${next.forfeited.length} forfeited.`);
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <section>
      <p className="eyebrow">{isAuctioneer ? "Auctioneer" : "Anyone can run these"}</p>
      <div className="panel">
        {canSeal && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Seal</h3>
            <p className="note">
              Freezes the bid set and stamps the block. Permissionless on purpose — if
              only the auctioneer could call it, it could stall until the book suited it.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => invoke("seal", [auction.terms.auctionId.toString()])}
                disabled={!connection}
              >
                Seal the auction
              </button>
            </div>
          </div>
        )}

        {canSettle && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Settle</h3>
            <p className="note">
              Builds the {bids.length + 1} witnesses the contract checks. Only the
              clearing price and the winning index reach the chain; every other bid is
              proved at or below the price without being opened.
            </p>
            <div>
              <label htmlFor="pasted">Pasted reveals, if the relay missed any</label>
              <textarea
                id="pasted"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='[{"auctionId":"0","index":0,"seed":"123","level":6}]'
                rows={3}
                style={{
                  width: "100%", fontFamily: "var(--font-mono), monospace",
                  fontSize: "var(--step--1)", padding: ".5rem .6rem",
                  border: "1px solid var(--rule)", borderRadius: "2px",
                  background: "var(--paper)", color: "var(--ink)", resize: "vertical",
                }}
              />
            </div>
            <div className="row">
              <button onClick={build}>Collect reveals and rank</button>
              {plan && (
                <button
                  className="primary"
                  disabled={problems.length > 0 || !connection}
                  onClick={() =>
                    invoke(
                      "settle",
                      settleCalldata(
                        auction.terms.auctionId,
                        plan.clearingLevel,
                        plan.winnerIndex,
                        plan.proofs,
                      ),
                    )
                  }
                >
                  Submit the proof
                </button>
              )}
            </div>

            {plan && (
              <>
                <dl className="facts">
                  <div className="fact">
                    <dt>Clearing price</dt>
                    <dd>{formatUnits(plan.clearingPrice, auction.paymentDecimals)} {auction.paymentSymbol}</dd>
                  </div>
                  <div className="fact">
                    <dt>Winning bid</dt><dd>#{plan.winnerIndex}</dd>
                  </div>
                  <div className="fact">
                    <dt>Forfeited</dt>
                    <dd>{plan.forfeited.length === 0 ? "none" : plan.forfeited.join(", ")}</dd>
                  </div>
                </dl>
                {problems.length > 0 ? (
                  <ul className="err" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {problems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                ) : (
                  <p className="ok">
                    Every witness verifies locally. The contract checks the same things.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {canFinalize && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Finalize</h3>
            <p className="note">
              The dispute window has closed clean. This is the step that moves money.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => invoke("finalize", [auction.terms.auctionId.toString()])}
                disabled={!connection}
              >
                Release the funds
              </button>
            </div>
          </div>
        )}

        {auction.status === Status.Settled && !canFinalize && (
          <p className="note warn">
            Nothing has moved. Funds release in{" "}
            <span className="countdown">{countdown(auction.disputeDeadline, now) ?? "…"}</span>
            {" "}— {utcDate(auction.disputeDeadline)}.
          </p>
        )}

        {msg && <p className="ok mono" style={{ marginTop: ".7rem" }}>{msg}</p>}
        {err && <p className="err" style={{ marginTop: ".7rem" }}>{err}</p>}
      </div>
    </section>
  );
}
