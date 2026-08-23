"use client";

import { useState } from "react";
import {
  AuctionOperation,
  claimActions,
  createBid,
  disputeWitness,
  placeBidActions,
  redeemWitness,
  Status,
} from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { config, formatUnits } from "@/lib/config";
import { markRevealed, saveBid, toPrivateBid, type StoredBid } from "@/lib/vault";
import type { Connection } from "@/lib/wallet";

/** Places a bid, then makes very sure the user knows the secret is theirs to keep. */
export function PlaceBid({
  auction,
  connection,
  onPlaced,
}: {
  auction: AuctionView;
  connection: Connection | null;
  onPlaced: () => void;
}) {
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<StoredBid | null>(null);

  const price = auction.terms.reservePrice + auction.terms.tick * BigInt(level);

  async function submit() {
    if (!connection) return setError("Connect a wallet first.");
    setBusy(true);
    setError(null);
    try {
      const bid = createBid(auction.terms, level);
      // Saved before submitting: if the transaction lands and the secret did not,
      // the money is unreachable.
      const stored = saveBid(auction.terms.auctionId, bid, auction.bidCount);

      const actions = placeBidActions({
        helper: config.anonymizerAddress,
        paymentToken: auction.paymentToken,
        collateral: auction.collateral,
        auctionId: auction.terms.auctionId,
        claimCommitment: bid.claimCommitment,
        upAnchor: bid.upAnchor,
        downAnchor: bid.downAnchor,
      });

      // Dry-run first: the cheapest way to catch a calldata-shape mistake, and the
      // action envelope here is not yet verified against a live wallet.
      await connection.account.strk20PrepareInvoke(actions, true);
      const { transaction_hash } = await connection.account.strk20InvokeTransaction(actions);

      setPlaced({ ...stored, txHash: transaction_hash });
      onPlaced();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <div className="panel">
        <h3>Bid placed</h3>
        <p className="small">
          Nothing about the amount left this browser. The chain has two hashes and a
          claim commitment.
        </p>
        <p className="small err">
          <strong>Keep this.</strong> The claim secret below is the only thing that can
          collect your refund or the lot. There is no server copy and no recovery.
        </p>
        <div className="field">
          <label>Claim secret</label>
          <div className="mono">{placed.claimSecret}</div>
        </div>
        {placed.txHash && (
          <div className="field">
            <label>Transaction</label>
            <div className="mono">{placed.txHash}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Place a bid</h3>
      <p className="small muted">
        Every bidder escrows the same amount — {formatUnits(auction.collateral)} — so the
        escrow says nothing about the bid behind it. You get the difference back
        privately.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Level (0 – {auction.terms.numLevels - 1})</label>
          <input
            type="number"
            min={0}
            max={auction.terms.numLevels - 1}
            value={level}
            onChange={(e) => setLevel(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="field">
          <label>Your bid</label>
          <input value={formatUnits(price)} readOnly />
        </div>
      </div>
      <div className="row">
        <button className="primary" onClick={submit} disabled={busy || !connection}>
          {busy ? "Proving…" : "Bid privately"}
        </button>
        <span className="small muted">Proving takes around 30 seconds.</span>
      </div>
      {error && <p className="small err">{error}</p>}
    </div>
  );
}

/** After sealing, and only after, the bidder hands the auctioneer their seed. */
export function RevealPanel({ auction, bids }: { auction: AuctionView; bids: StoredBid[] }) {
  const [state, setState] = useState<Record<number, string>>({});

  if (auction.status !== Status.Sealed) return null;

  async function reveal(bid: StoredBid) {
    setState((s) => ({ ...s, [bid.index]: "sending" }));
    try {
      const res = await fetch("/api/reveals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auctionId: bid.auctionId,
          index: bid.index,
          seed: bid.seed,
          level: bid.level,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      markRevealed(BigInt(bid.auctionId), bid.index);
      setState((s) => ({ ...s, [bid.index]: "sent" }));
    } catch (e) {
      setState((s) => ({ ...s, [bid.index]: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <div className="panel">
      <h3>Send your seed to the auctioneer</h3>
      <p className="small muted">
        The bid set is now frozen on-chain, so this is safe: the auctioneer committed to
        exactly these bids before it could read any of them. Your claim secret is not
        included and never leaves this browser.
      </p>
      {bids.length === 0 && <p className="small muted">You have no bids in this auction.</p>}
      {bids.map((b) => (
        <div key={b.index} className="row" style={{ marginTop: ".5rem" }}>
          <span className="small">
            Bid #{b.index} at level {b.level}
          </span>
          <button onClick={() => reveal(b)} disabled={state[b.index] === "sending"}>
            {state[b.index] === "sent" ? "Sent" : "Send seed"}
          </button>
          {state[b.index] && state[b.index] !== "sent" && state[b.index] !== "sending" && (
            <span className="small err">{state[b.index]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Refund, surplus, forfeited escrow, the lot — all back as private notes. */
export function ClaimPanel({
  auction,
  bids,
  connection,
}: {
  auction: AuctionView;
  bids: StoredBid[];
  connection: Connection | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (auction.status !== Status.Finalized && auction.status !== Status.Cancelled) return null;
  if (bids.length === 0) return null;

  async function run(
    operation:
      | AuctionOperation.ClaimRefund
      | AuctionOperation.RedeemForfeit
      | AuctionOperation.ClaimLot,
    stored: StoredBid,
  ) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null);
    setMsg(null);
    try {
      const bid = toPrivateBid(stored);
      const actions = claimActions(operation, {
        helper: config.anonymizerAddress,
        token: operation === AuctionOperation.ClaimLot ? auction.lotToken : auction.paymentToken,
        owner: connection.address,
        auctionId: auction.terms.auctionId,
        bidIndex: bid.index,
        claimSecret: bid.claimSecret,
        witnessDown:
          operation === AuctionOperation.RedeemForfeit
            ? redeemWitness(auction.terms, bid, auction.clearingLevel)
            : 0n,
      });
      const { transaction_hash } = await connection.account.strk20InvokeTransaction(actions);
      setMsg(`Submitted: ${transaction_hash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Collect</h3>
      <p className="small muted">
        Everything comes back as a private note, so what you get — and whether you were
        the winner — stays off the chain.
      </p>
      {bids.map((b) => (
        <div key={b.index} className="row" style={{ marginTop: ".5rem" }}>
          <span className="small">Bid #{b.index}</span>
          <button onClick={() => run(AuctionOperation.ClaimRefund, b)}>Refund / surplus</button>
          <button onClick={() => run(AuctionOperation.RedeemForfeit, b)}>Redeem forfeit</button>
          {b.index === auction.winnerIndex && (
            <button className="primary" onClick={() => run(AuctionOperation.ClaimLot, b)}>
              Claim the lot
            </button>
          )}
        </div>
      ))}
      {msg && <p className="small ok">{msg}</p>}
      {err && <p className="small err">{err}</p>}
    </div>
  );
}

/** The escape hatch: prove you were above the clearing price and void the result. */
export function DisputePanel({
  auction,
  bids,
  connection,
}: {
  auction: AuctionView;
  bids: StoredBid[];
  connection: Connection | null;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auction.status !== Status.Settled) return null;
  const eligible = bids.filter((b) => b.level > auction.clearingLevel);
  if (eligible.length === 0) return null;

  async function dispute(stored: StoredBid) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null);
    try {
      const bid = toPrivateBid(stored);
      const witness = disputeWitness(auction.terms, bid, auction.clearingLevel);
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "dispute",
        calldata: [
          auction.terms.auctionId.toString(),
          bid.index.toString(),
          witness.toString(),
        ],
      });
      setMsg(`Submitted: ${res.transaction_hash}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Your bid was above the clearing price</h3>
      <p className="small muted">
        The settlement did not account for it. Proving that voids the result and pays you
        the auctioneer's bond. You do not have to reveal what you bid — only that it was
        above level {auction.clearingLevel}.
      </p>
      {eligible.map((b) => (
        <div key={b.index} className="row" style={{ marginTop: ".5rem" }}>
          <span className="small">Bid #{b.index}</span>
          <button className="primary" onClick={() => dispute(b)}>
            Void the settlement
          </button>
        </div>
      ))}
      {msg && <p className="small ok">{msg}</p>}
      {err && <p className="small err">{err}</p>}
    </div>
  );
}
