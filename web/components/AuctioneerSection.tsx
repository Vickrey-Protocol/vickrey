"use client";

import { useEffect, useState } from "react";
import {
  openAsAuctioneer,
  planSettlement,
  revealMatches,
  type PublicBid,
  type Reveal,
  type SettlementPlan,
  Status,
  verifyPlan,
} from "@vickrey/client";
import {
  provider, readPostedReveals, revealDeadline, settleCalldata, type AuctionView,
} from "@/lib/chain";
import { countdown, formatUnits, utcDate } from "@/lib/config";
import {
  findRevealKey, forgetRevealKey, keepRevealKey, parseRevealKeyFile, type StoredRevealKey,
} from "@/lib/revealKeys";
import { receiptOutcome, shortRevert } from "@/lib/receipt";
import { simpleCall } from "@/lib/v2";
import type { Connection } from "@/lib/wallet";
import { useWallet } from "@/components/WalletProvider";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The auctioneer's controls, as a section of the one page. `seal` and `finalize` are
 * permissionless and offered to anyone; `settle` only to the auctioneer.
 *
 * Settlement reads the reveals bidders posted on chain, encrypted to this auction's
 * key, and decrypts them here with the secret half — from this browser's store, or from
 * the file downloaded at listing. Every decrypted reveal is checked against the bid's
 * own anchors, so one that does not match forfeits that bid rather than being believed.
 */
export function AuctioneerSection({
  auction, bids, connection, now, isAuctioneer,
}: {
  auction: AuctionView;
  bids: PublicBid[];
  connection: Connection | null;
  now: number;
  isAuctioneer: boolean;
}) {
  const [plan, setPlan] = useState<SettlementPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const { ensureChain } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<StoredRevealKey | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);

  const deadline = revealDeadline(auction);
  const final = auction.status === Status.Finalized || auction.status === Status.Cancelled;
  useEffect(() => { setKey(findRevealKey(auction.revealKeyX)); }, [auction.revealKeyX]);

  /* How many bids have a reveal on chain, while the window is open and after. */
  useEffect(() => {
    if (!isAuctioneer || auction.status !== Status.Sealed) return;
    let live = true;
    void readPostedReveals(auction)
      .then((rs) => { if (live) setRevealed(new Set(rs.map((r) => r.bidIndex)).size); })
      .catch(() => { if (live) setRevealed(null); });
    return () => { live = false; };
  }, [isAuctioneer, auction, now >= deadline]);

  const canSeal = auction.status === Status.Open && now >= auction.bidDeadline;
  const canFinalize = auction.status === Status.Settled && now >= auction.disputeDeadline;
  const sealedForMe = isAuctioneer && auction.status === Status.Sealed;
  const canForget = isAuctioneer && final && !!key;
  if (!canSeal && !canFinalize && !sealedForMe && !canForget) return null;

  async function invoke(entrypoint: "seal" | "finalize" | "settle", calldata?: string[]) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setMsg(null);
    if (!(await ensureChain())) return;
    try {
      const call = calldata
        ? { contractAddress: auction.contract, entrypoint, calldata }
        : simpleCall(auction.contract, entrypoint as "seal" | "finalize", auction.terms.auctionId);
      await provider().callContract(call);
      const res = await connection.account.execute(call);
      const outcome = receiptOutcome(await provider().waitForTransaction(res.transaction_hash));
      setMsg(outcome.kind === "reverted"
        ? `Reverted (${shortRevert(outcome.reason)}). Transaction ${res.transaction_hash}.`
        : `Done. Transaction ${res.transaction_hash}.`);
    } catch (e) { setErr(errText(e)); }
  }

  async function importKey(file: File) {
    setErr(null);
    try {
      const k = parseRevealKeyFile(await file.text());
      if (BigInt(k.publicX) !== auction.revealKeyX) throw new Error("This key is for a different auction.");
      keepRevealKey(k);
      setKey(k);
    } catch (e) { setErr(errText(e)); }
  }

  /** Decrypts every posted reveal, keeps the one per bid that matches its anchors. */
  async function build() {
    if (!key) return;
    setErr(null); setMsg(null);
    try {
      const posted = await readPostedReveals(auction);
      const reveals = new Map<number, Reveal>();
      for (const p of posted) {
        if (reveals.has(p.bidIndex)) continue;
        const bid = bids.find((b) => b.index === p.bidIndex);
        if (!bid) continue;
        const o = openAsAuctioneer(BigInt(key.secret), auction.terms.auctionId, p.bidIndex, p);
        if (o.level >= BigInt(auction.terms.numLevels)) continue;
        const r: Reveal = { index: p.bidIndex, seed: o.seed, level: Number(o.level) };
        /* Anyone can post against a bid; only a reveal that reproduces its anchors counts. */
        if (revealMatches(auction.terms, bid, r)) reveals.set(p.bidIndex, r);
      }
      const next = planSettlement(auction.terms, bids, [...reveals.values()]);
      setPlan(next);
      setProblems(verifyPlan(auction.terms, bids, next));
      setMsg(`${reveals.size} of ${bids.length} bids revealed on chain. ${next.forfeited.length} forfeited.`);
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <section>
      <p className="eyebrow">{isAuctioneer ? "Auctioneer" : "Anyone can run these"}</p>
      <div className="panel">
        {canSeal && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Seal</h3>
            <p className="note">
              <b>Freezes the bid set so no further bids can be added</b>, and stamps the block —
              before any bid is revealed, and so before anyone can read an amount. It also opens
              the reveal window. Permissionless on purpose, and irreversible.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void invoke("seal")} disabled={!connection}>Seal the auction</button>
            </div>
          </div>
        )}

        {sealedForMe && now < deadline && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Reveals arriving</h3>
            <p>
              {revealed === null ? "Reading the chain…" : <><b>{revealed}</b> of {bids.length} bids revealed so far.</>}{" "}
              The window closes in <span className="countdown">{countdown(deadline, now)}</span> — {utcDate(deadline)}.
              You can settle once it does.
            </p>
          </div>
        )}

        {sealedForMe && now >= deadline && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Settle</h3>
            {!key ? (
              <div className="warnbox">
                <b>This browser doesn’t hold this auction’s reveal key.</b> Load the file you
                downloaded when you listed it.
                <div style={{ marginTop: ".6rem" }}>
                  <input type="file" accept="application/json,.json" aria-label="Reveal key file"
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) void importKey(f); }} />
                </div>
              </div>
            ) : (
              <>
                <p className="note">
                  Reads the reveals posted on chain and decrypts them with your key, then builds
                  the proofs the contract checks. Only the clearing price and the winning index
                  reach the chain; every other bid is proved at or below the price without being
                  opened. It moves no money and opens the dispute window.
                </p>
                <div className="row">
                  <button onClick={() => void build()}>Read reveals and rank</button>
                  {plan && (
                    <button className="primary" disabled={problems.length > 0 || !connection}
                            onClick={() => void invoke("settle", settleCalldata(auction.terms.auctionId,
                              plan.clearingLevel, plan.winnerIndex, plan.proofs))}>
                      Submit the proof
                    </button>
                  )}
                </div>
              </>
            )}
            {plan && (
              <>
                <dl className="facts">
                  <div className="fact"><dt>Clearing price</dt>
                    <dd>{formatUnits(plan.clearingPrice, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>
                  <div className="fact"><dt>Winning bid</dt>
                    <dd>{plan.winnerIndex === 0xffffffff ? "none" : `#${plan.winnerIndex}`}</dd></div>
                  <div className="fact"><dt>Forfeited</dt>
                    <dd>{plan.forfeited.length === 0 ? "none" : plan.forfeited.join(", ")}</dd></div>
                </dl>
                {problems.length > 0 ? (
                  <ul className="err" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {problems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                ) : (
                  <p className="ok">Every witness verifies locally. The contract checks the same things.</p>
                )}
              </>
            )}
          </div>
        )}

        {canFinalize && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Finalize</h3>
            <p className="note">The dispute window has closed clean. This records what everyone is owed.</p>
            <div className="row">
              <button className="primary" onClick={() => void invoke("finalize")} disabled={!connection}>Finalize</button>
            </div>
          </div>
        )}

        {auction.status === Status.Settled && !canFinalize && (
          <p className="note warn">
            Nothing has moved. It can be finalized in{" "}
            <span className="countdown">{countdown(auction.disputeDeadline, now) ?? "…"}</span>
            {" "}— {utcDate(auction.disputeDeadline)}.
          </p>
        )}

        {canForget && (
          <div className="stack" style={{ gap: ".6rem" }}>
            <h3 style={{ fontSize: "var(--step-1)" }}>Delete this auction’s reveal key</h3>
            <p className="note">
              The auction is final, so you no longer need it. Anyone who ever gets it can read
              this auction’s bids: delete it here, and delete the file you downloaded.
            </p>
            <div className="row">
              <button onClick={() => { forgetRevealKey(auction.revealKeyX); setKey(null); }}>Delete it from this browser</button>
            </div>
          </div>
        )}

        {msg && <p className="ok mono" style={{ marginTop: ".7rem", wordBreak: "break-all" }}>{msg}</p>}
        {err && <p className="err" style={{ marginTop: ".7rem" }}>{err}</p>}
      </div>
    </section>
  );
}
