"use client";

import { useState } from "react";
import { CallData, num } from "starknet";
import {
  AuctionOperation,
  type ClaimOperation,
  claimActions,
  createBid,
  disputeWitness,
  placeBidActions,
  redeemWitness,
  Status,
} from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { config, countdown, formatUnits, hasAnonymizer, priceAt } from "@/lib/config";
import { markRevealed, saveBid, toPrivateBid, type StoredBid } from "@/lib/vault";
import type { Connection } from "@/lib/wallet";
import { Ladder } from "./Ladder";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ── bidding ─────────────────────────────────────────────────────────── */

/**
 * The two rails a bid can travel on, and what each one reveals.
 *
 * A privacy product that lets someone choose a rail without understanding it has failed
 * at the only thing it does. Both rails seal the amount — that is the auction, not the
 * pool. What differs is whether the *bidder's address* is visible, and who pays.
 *
 * The sponsored rail is costed and designed (docs/access.md) but no relayer is
 * deployed, so it is shown and not offered. Drawing a button that cannot run would be
 * inventing capability.
 */
type Rail = "public" | "private";

export function BidPanel({
  auction,
  connection,
  onPlaced,
}: {
  auction: AuctionView;
  connection: Connection | null;
  onPlaced: () => void;
}) {
  const [level, setLevel] = useState<number | null>(null);
  const [rail, setRail] = useState<Rail>("public");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<StoredBid | null>(null);
  const [ack, setAck] = useState(false);

  const canPrivate = !!connection?.strk20 && hasAnonymizer();

  async function submit() {
    if (!connection) return setError("Connect a wallet first.");
    if (level === null) return setError("Pick a level on the ladder.");
    setError(null);
    try {
      const bid = createBid(auction.terms, level);
      // Stored before submitting. If the transaction lands and the secret does not,
      // the money is unreachable.
      const stored = saveBid(auction.terms.auctionId, bid, auction.bidCount);
      let transaction_hash: string;

      if (rail === "public") {
        /* Straight at the auction contract. The amount is still sealed — it was never
           in the calldata — but the escrow transfer names the bidder. */
        setBusy("Waiting for your wallet…");
        ({ transaction_hash } = await connection.account.execute([
          { contractAddress: auction.paymentToken, entrypoint: "approve",
            calldata: CallData.compile([
              config.auctionAddress, num.toHex(auction.collateral), "0x0"]) },
          { contractAddress: config.auctionAddress, entrypoint: "place_bid",
            calldata: CallData.compile([
              num.toHex(auction.terms.auctionId), num.toHex(bid.claimCommitment),
              num.toHex(bid.upAnchor), num.toHex(bid.downAnchor)]) },
        ]));
      } else {
        if (!hasAnonymizer()) return setError("No anonymizer address is configured.");
        const actions = placeBidActions({
          helper: config.anonymizerAddress,
          paymentToken: auction.paymentToken,
          collateral: auction.collateral,
          auctionId: auction.terms.auctionId,
          claimCommitment: bid.claimCommitment,
          upAnchor: bid.upAnchor,
          downAnchor: bid.downAnchor,
        });
        setBusy("Checking the transaction shape…");
        await connection.account.strk20PrepareInvoke(actions, true);
        setBusy("Proving. This takes about 30 seconds — the wallet is not stuck.");
        ({ transaction_hash } = await connection.account.strk20InvokeTransaction(actions));
      }

      setPlaced({ ...stored, txHash: transaction_hash });
      onPlaced();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  // R3: losing this loses the refund, and there is no recovery. It gets a wall.
  if (placed) {
    return (
      <div className="secret">
        <h3 style={{ fontSize: "var(--step-1)", marginBottom: ".4rem" }}>
          Save your claim secret
        </h3>
        <p className="note" style={{ color: "var(--ink-soft)" }}>
          This is the only thing that can collect your refund or the lot. It is not on
          any server and there is no recovery. If you clear this browser without it,
          the money stays in the contract for good.
        </p>
        <div className="value">{placed.claimSecret}</div>
        <div className="row">
          <button onClick={() => navigator.clipboard?.writeText(placed.claimSecret)}>
            Copy
          </button>
          <label style={{ display: "flex", gap: ".45rem", alignItems: "center", margin: 0 }}>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ width: "auto" }}
            />
            I have saved it
          </label>
          <button className="primary" disabled={!ack} onClick={() => setPlaced(null)}>
            Continue
          </button>
        </div>
        {placed.txHash && (
          <p className="note mono" style={{ marginTop: ".7rem" }}>{placed.txHash}</p>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h3 style={{ fontSize: "var(--step-1)" }}>Place a bid</h3>
        <p className="note">
          Pick a level. Everyone escrows the same {formatUnits(auction.collateral)}{" "}
          {auction.paymentSymbol}, which is what stops the escrow saying anything about
          the bid behind it — the difference comes back to you privately.
        </p>
      </div>

      {/* The rail, chosen before the amount, because it is the decision with a
          disclosure consequence and burying it under the ladder makes it a default
          rather than a choice.

          Public is first and marked as the ordinary path, which is honest rather than
          modest. The Wallet API has no deposit method, so the private rail requires
          leaving this page, shielding inside your own wallet, and paying the pool fee
          before you can even start — almost nobody completes that in one sitting.
          Presenting it as the expected route would be setting most visitors up to
          abandon a bid halfway. */}
      <div className="rails">
        <button className={rail === "public" ? "rail on" : "rail"}
                onClick={() => setRail("public")} aria-pressed={rail === "public"}>
          <span className="rail-name">Public rail <span className="rail-tag">usual</span></span>
          <span className="note">
            Bid straight from this wallet. Nothing to set up.
          </span>
          <span className="rail-cost">gas only · ~0.25 STRK</span>
        </button>

        <button className={rail === "private" ? "rail on" : "rail"}
                onClick={() => canPrivate && setRail("private")}
                disabled={!canPrivate} aria-pressed={rail === "private"}>
          <span className="rail-name">Private rail</span>
          <span className="note">
            {canPrivate
              ? "Also hides your address. Needs a shielded balance first."
              : connection && !connection.strk20
                ? "This wallet does not speak STRK20."
                : "No anonymizer configured."}
          </span>
          <span className="rail-cost">
            {auction.poolFee === null ? "pool fee + gas" : `${formatUnits(auction.poolFee)} STRK pool fee + gas`}
          </span>
        </button>

        <div className="rail muted" aria-disabled="true">
          <span className="rail-name">Sponsored private</span>
          <span className="note">
            We pay the pool fee for you. Designed and costed, no relayer deployed yet.
          </span>
          <span className="rail-cost">free to you · not available</span>
        </div>
      </div>

      <p className="note">
        <b>Both rails seal your bid.</b> The only difference is whether your address is
        publicly linked to having bid.
      </p>

      {rail === "private" && canPrivate && (
        <div className="panel" style={{ background: "var(--hatch-bg)" }}>
          <p className="eyebrow">Before this will work</p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            The private rail spends from a <b>shielded balance</b>, and{" "}
            <b>shielding does not happen here</b> — the wallet standard has no deposit
            method, so no site can do it for you. Open your wallet&rsquo;s private balance
            section and shield there first. The pool charges{" "}
            {auction.poolFee === null ? "its fee" : <b>{formatUnits(auction.poolFee)} STRK</b>}{" "}
            for the shield and again for the bid.
          </p>
          <p className="note" style={{ marginTop: ".4rem" }}>
            If that is more than you want to do to try this, the public rail seals your
            bid just as completely.
          </p>
        </div>
      )}

      {/* Ladder left, the numbers and the action right, so the panel is not mostly
          empty glass at full width. */}
      <div className="bid-grid">
        <Ladder
          numLevels={auction.terms.numLevels}
          reservePrice={auction.terms.reservePrice}
          tick={auction.terms.tick}
          symbol={auction.paymentSymbol}
          bidCount={auction.bidCount}
          status={auction.status}
          pickedLevel={level}
          onPick={setLevel}
        />

        <div className="stack" style={{ gap: ".9rem" }}>
          <dl className="facts">
            <div className="fact">
              <dt>Your bid</dt>
              <dd>
                {level === null ? (
                  "—"
                ) : (
                  <span className="price" style={{ fontSize: "1.6rem" }}>
                    {formatUnits(priceAt(auction.terms, level))}
                  </span>
                )}
                {level !== null && ` ${auction.paymentSymbol}`}
              </dd>
            </div>
            <div className="fact">
              <dt>You escrow</dt>
              <dd>{formatUnits(auction.collateral)} {auction.paymentSymbol}</dd>
            </div>
            <div className="fact">
              {/* The pool charges its fee in STRK whatever the auction settles in. */}
              <dt>Pool fee</dt>
              <dd>{auction.poolFee === null ? "—" : `${formatUnits(auction.poolFee)} STRK`}</dd>
            </div>
          </dl>

          <div className="row">
            <button className="primary" onClick={submit} disabled={!!busy || !connection}>
              {busy ? "Working…" : rail === "private" ? "Bid privately" : "Place sealed bid"}
            </button>
            {/* R5: name the wait before it starts. */}
            <span className="note">
              {busy ?? (rail === "private"
                ? "Proving takes about 30 seconds."
                : "One transaction: approve, then place.")}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="err">{error}</p>}
    </div>
  );
}

/* ── reveal ──────────────────────────────────────────────────────────── */

export function RevealPanel({ auction, bids }: { auction: AuctionView; bids: StoredBid[] }) {
  const [state, setState] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);
  if (auction.status !== Status.Sealed || bids.length === 0) return null;

  /**
   * The same payload the relay would carry, as text.
   *
   * The relay is a convenience, not a dependency: it runs on serverless and its
   * memory does not survive an instance recycling. A demo that can be lost to a cold
   * start is not a demo, so the reveal can always be handed over by any channel.
   */
  const blob = JSON.stringify(
    bids.map((b) => ({
      auctionId: b.auctionId, index: b.index, seed: b.seed, level: b.level,
    })),
  );

  async function reveal(bid: StoredBid) {
    setState((s) => ({ ...s, [bid.index]: "sending" }));
    try {
      const res = await fetch("/api/reveals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auctionId: bid.auctionId, index: bid.index, seed: bid.seed, level: bid.level,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      markRevealed(BigInt(bid.auctionId), bid.index);
      setState((s) => ({ ...s, [bid.index]: "sent" }));
    } catch (e) {
      setState((s) => ({ ...s, [bid.index]: errText(e) }));
    }
  }

  return (
    <div className="panel">
      <h3 style={{ fontSize: "var(--step-1)" }}>Send your seed to the auctioneer</h3>
      <p className="note">
        Safe now, and not before. The bid set is frozen on chain, so the auctioneer
        committed to exactly these bids before it could read any of them. Your claim
        secret is not included and never leaves this browser.
      </p>
      <div className="stack" style={{ gap: ".5rem", marginTop: ".8rem" }}>
        {bids.map((b) => (
          <div className="row" key={b.index}>
            <span className="note">Bid #{b.index}</span>
            <button onClick={() => reveal(b)} disabled={state[b.index] === "sending"}>
              {state[b.index] === "sent" ? "Sent" : "Send seed"}
            </button>
            {state[b.index] && !["sent", "sending"].includes(state[b.index]!) && (
              <span className="err">{state[b.index]}</span>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: ".9rem" }}>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(blob);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy as text"}
        </button>
        <span className="note">
          A fallback that needs no server. Hand it over any way you like.
        </span>
      </div>
    </div>
  );
}

/* ── dispute ─────────────────────────────────────────────────────────── */

export function DisputePanel({
  auction, bids, connection, now,
}: {
  auction: AuctionView; bids: StoredBid[]; connection: Connection | null; now: number;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (auction.status !== Status.Settled) return null;
  const eligible = bids.filter((b) => b.level > auction.clearingLevel);
  if (eligible.length === 0) return null;
  const left = countdown(auction.disputeDeadline, now);

  async function dispute(stored: StoredBid) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null);
    try {
      const bid = toPrivateBid(stored);
      const witness = disputeWitness(auction.terms, bid, auction.clearingLevel);
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "dispute",
        calldata: [auction.terms.auctionId.toString(), String(bid.index), witness.toString()],
      });
      setMsg(res.transaction_hash);
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div className="panel accent">
      <h3 style={{ fontSize: "var(--step-1)" }}>Your bid was above the clearing price</h3>
      <p className="note">
        The settlement did not account for it. Proving that voids the result and pays
        you the auctioneer&apos;s bond. You do not reveal what you bid — only that it
        was above this line. {left ? <>Window closes in <span className="countdown">{left}</span>.</> : "The window has closed."}
      </p>
      <div className="stack" style={{ gap: ".5rem", marginTop: ".8rem" }}>
        {eligible.map((b) => (
          <div className="row" key={b.index}>
            <span className="note">Bid #{b.index}</span>
            <button className="primary" onClick={() => dispute(b)} disabled={!left}>
              Void the settlement
            </button>
          </div>
        ))}
      </div>
      {msg && <p className="ok mono">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── collect ─────────────────────────────────────────────────────────── */

export function ClaimPanel({
  auction, bids, connection,
}: {
  auction: AuctionView; bids: StoredBid[]; connection: Connection | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const final = auction.status === Status.Finalized || auction.status === Status.Cancelled;
  if (!final || bids.length === 0) return null;

  async function run(operation: ClaimOperation, stored: StoredBid) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setMsg(null);
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
      setMsg(transaction_hash);
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div className="panel">
      <h3 style={{ fontSize: "var(--step-1)" }}>Collect</h3>
      <p className="note">
        Everything comes back as a private note, so collecting does not put your
        address on chain beside a price.
      </p>
      <div className="stack" style={{ gap: ".5rem", marginTop: ".8rem" }}>
        {bids.map((b) => (
          <div className="row" key={b.index}>
            <span className="note">Bid #{b.index}</span>
            <button onClick={() => run(AuctionOperation.ClaimRefund, b)}>
              Refund or surplus
            </button>
            <button onClick={() => run(AuctionOperation.RedeemForfeit, b)}>
              Redeem forfeit
            </button>
            {b.index === auction.winnerIndex && auction.status === Status.Finalized && (
              <button className="primary" onClick={() => run(AuctionOperation.ClaimLot, b)}>
                Claim the lot
              </button>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="ok mono">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
