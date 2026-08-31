"use client";

import { useEffect, useState } from "react";
import { CallData, num } from "starknet";
import {
  AuctionOperation,
  type ClaimOperation,
  Disposition,
  claimActions,
  createBid,
  disputeWitness,
  placeBidActions,
  readWalletError,
  redeemWitness,
  Status,
} from "@vickrey/client";
import { readBidState, type AuctionView, type BidState } from "@/lib/chain";
import {
  STRK_DECIMALS, config, countdown, formatUnits, hasAnonymizer, priceAt, utcDate,
} from "@/lib/config";
import { markRevealed, saveBid, toPrivateBid, type StoredBid } from "@/lib/vault";
import { railUsable, submitBlocked } from "@/lib/rails";
import type { Connection } from "@/lib/wallet";
import { Ladder } from "./Ladder";
import { useWallet } from "@/components/WalletProvider";

/**
 * Never `String(e)` on a wallet error: a JSON-RPC error is a plain object, so that
 * yields "[object Object]" and discards the code. `readWalletError` maps the spec's
 * twelve codes to sentences and says plainly when it does not recognise one.
 */
const errText = (e: unknown) => {
  const err = readWalletError(e);
  return err.recognised || err.code !== null
    ? (err.recognised ? err.say : `${err.say} Raw: ${err.raw}`)
    : (e instanceof Error ? e.message : err.raw);
};

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
  const { ensureChain, strk20Proof, noteStrk20Error } = useWallet();
  const [level, setLevel] = useState<number | null>(null);
  const [rail, setRail] = useState<Rail>("public");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<StoredBid | null>(null);
  const [ack, setAck] = useState(false);

  const canPrivate = !!connection?.strk20Declared && hasAnonymizer() && strk20Proof !== "failed";

  /* A rail selected before a real call failed would otherwise stay selected after it —
     the rail's own button greys out and explains itself while the submit button beside
     it still reads "Bid privately" and still fires. */
  useEffect(() => {
    if (!canPrivate && rail === "private") setRail("public");
  }, [canPrivate, rail]);

  async function submit() {
    if (!connection) return setError("Connect a wallet first.");
    if (level === null) return setError("Pick a level on the ladder.");
    /* Belt and braces with the effect above and the disabled button below: three ways to
       reach this and only one of them needs to be missed. */
    if (!railUsable(rail, canPrivate)) {
      return setError("The private rail is unavailable with this wallet on this network. "
        + "Switch to the public rail.");
    }
    if (!(await ensureChain())) return;
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
      /* A private-rail failure is the same pool read failing. Recording it stops the
         rail being offered again, so the next attempt is a button that explains itself
         rather than a bid that fails. */
      if (rail === "private") noteStrk20Error(e);
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
          Pick a level. Everyone escrows the same {formatUnits(auction.collateral, auction.paymentDecimals)}{" "}
          {auction.paymentSymbol}, which is what stops the escrow saying anything about
          the bid behind it — the difference comes back to you privately.
        </p>
      </div>

      {/* The rail, chosen before the amount, because it is the decision with a
          disclosure consequence and burying it under the ladder makes it a default
          rather than a choice.

          Public is first and marked as the ordinary path, which is honest rather than
          modest. The private rail needs a shielded balance that exists before the bid
          does, and this app deliberately does not create one for you — see the note in
          the panel. (It *could*: `strk20InvokeTransaction` accepts a deposit action. The
          reason it does not is a product decision, not a limit of the standard.) So the
          rail requires leaving this page, shielding inside your wallet, and paying the
          pool fee before you can even start — almost nobody does that in one sitting.
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
              : connection && !connection.strk20Declared
                /* What we know is what it advertises. Whether a pool call actually works
                   is a different question and only a real call answers it. */
                ? "This wallet does not advertise STRK20 support."
                : strk20Proof === "failed"
                  /* Proven, not guessed: a real call to this wallet failed on this
                     network. Ready X does this on Sepolia. Offering the rail anyway
                     means the bid fails instead of the button explaining itself. */
                  ? `A real pool read failed with this wallet on ${config.label}. `
                    + "Try Xverse, or use the public rail."
                  : "No anonymizer configured."}
          </span>
          <span className="rail-cost">
            {auction.poolFee === null ? "pool fee + gas" : `${formatUnits(auction.poolFee, STRK_DECIMALS)} STRK pool fee + gas`}
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
            <b>shielding does not happen here</b>. The standard would allow it —{" "}
            <code>strk20InvokeTransaction</code> takes a deposit action — but your first
            shield is the one step where seeing the amount in your own wallet is worth
            more than the convenience. Open your wallet&rsquo;s private balance section
            and shield there. The pool charges{" "}
            {auction.poolFee === null ? "its fee" : <b>{formatUnits(auction.poolFee, STRK_DECIMALS)} STRK</b>}{" "}
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
          decimals={auction.paymentDecimals}
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
                    {formatUnits(priceAt(auction.terms, level), auction.paymentDecimals)}
                  </span>
                )}
                {level !== null && ` ${auction.paymentSymbol}`}
              </dd>
            </div>
            <div className="fact">
              <dt>You escrow</dt>
              <dd>{formatUnits(auction.collateral, auction.paymentDecimals)} {auction.paymentSymbol}</dd>
            </div>
            <div className="fact">
              {/* The pool charges its fee in STRK whatever the auction settles in. */}
              <dt>Pool fee</dt>
              <dd>{auction.poolFee === null ? "—" : `${formatUnits(auction.poolFee, STRK_DECIMALS)} STRK`}</dd>
            </div>
          </dl>

          <div className="row">
            <button className="primary" onClick={submit}
                    disabled={submitBlocked({ rail, canPrivate, busy: !!busy, connected: !!connection })}>
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
        committed to exactly these bids before being able to read any of them.
      </p>
      {/* Said plainly at the moment of handing it over, because this is where a bidder
          decides. The seed and level together are the bid; there is no version of this
          step where the auctioneer does not learn the amount. */}
      <p className="note" style={{ marginTop: ".5rem" }}>
        <b>This tells the auctioneer your exact bid.</b> It has to — they cannot prove
        where it sits without it. What it does not do is put an amount on chain, and it
        does not include your claim secret, which never leaves this browser.
      </p>

      {/* Copy first. The relay is off by default and cannot survive a cold start even
          when it is on, so the channel the bidder chooses is the real one. */}
      <div className="row" style={{ marginTop: "1rem", gap: ".6rem", flexWrap: "wrap" }}>
        <button className="primary"
          onClick={() => { navigator.clipboard?.writeText(blob); setCopied(true); }}>
          {copied ? "Copied" : "Copy reveal for the auctioneer"}
        </button>
        <span className="note">
          Send it however you and the auctioneer already talk. Anyone holding it can read
          your bid, so pick the channel accordingly.
        </span>
      </div>

      <details style={{ marginTop: ".9rem" }}>
        <summary className="note">Or post it to the site&rsquo;s relay</summary>
        <p className="note" style={{ marginTop: ".5rem" }}>
          A convenience for demos, and <b>disabled in production</b>: its reads were
          unauthenticated, so anyone who guessed the auction id could have read every
          revealed bid. It is in-memory either way and a cold start loses it.
        </p>
        <div className="stack" style={{ gap: ".5rem", marginTop: ".6rem" }}>
          {bids.map((b) => (
            <div className="row" key={b.index}>
              <span className="note">Bid #{b.index}</span>
              <button onClick={() => reveal(b)} disabled={state[b.index] === "sending"}>
                {state[b.index] === "sent" ? "Sent" : "Post to relay"}
              </button>
              {state[b.index] && !["sent", "sending"].includes(state[b.index]!) && (
                <span className="err">{state[b.index]}</span>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ── dispute ─────────────────────────────────────────────────────────── */

export function DisputePanel({
  auction, bids, connection, now,
}: {
  auction: AuctionView; bids: StoredBid[]; connection: Connection | null; now: number;
}) {
  const { ensureChain } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (auction.status !== Status.Settled) return null;
  const eligible = bids.filter((b) => b.level > auction.clearingLevel);
  if (eligible.length === 0) return null;
  const left = countdown(auction.disputeDeadline, now);

  async function dispute(stored: StoredBid) {
    if (!connection) return setErr("Connect a wallet first.");
    if (!(await ensureChain())) return;
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

/**
 * Which of the two collect calls this bid can actually make.
 *
 * The contract is strict in both directions and the screen used to offer both buttons
 * side by side, so one of them always reverted. On the screen whose entire job is
 * releasing the user's escrow, a revert reads as "the money is gone".
 *
 *   `claim_refund`   Finalized or Cancelled; on Finalized it refuses a forfeited bid.
 *   `redeem_forfeit` Finalized only, and only a forfeited bid.
 *
 * A cancelled auction refunds everyone including forfeits — no settlement ever
 * established who forfeited — so `claim_refund` is right there whatever the disposition.
 */
export const isForfeit = (st: BidState, status: Status) =>
  status === Status.Finalized && st.disposition === Disposition.Forfeit;

export const collectOp = (st: BidState, status: Status): ClaimOperation =>
  isForfeit(st, status) ? AuctionOperation.RedeemForfeit : AuctionOperation.ClaimRefund;

const collectLabel = (st: BidState, status: Status) =>
  isForfeit(st, status) ? "Redeem forfeit" : "Refund or surplus";

export function ClaimPanel({
  auction, bids, connection,
}: {
  auction: AuctionView; bids: StoredBid[]; connection: Connection | null;
}) {
  const { ensureChain, strk20Proof, noteStrk20Error } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canPrivate = !!connection?.strk20Declared && hasAnonymizer() && strk20Proof !== "failed";
  const [rail, setRail] = useState<Rail>("public");

  /* A rail selected before a real call failed would otherwise stay selected after it —
     the rail's own button greys out and explains itself while the submit button beside
     it still says "Bid privately" and still fires. */
  useEffect(() => {
    if (!canPrivate && rail === "private") setRail("public");
  }, [canPrivate, rail]);

  /* `undefined` = still reading, `null` = the read failed. Distinguishing them matters:
     one is a spinner and the other has to fall back to offering both calls. */
  const [state, setState] = useState<Record<number, BidState | null | undefined>>({});

  const final = auction.status === Status.Finalized || auction.status === Status.Cancelled;

  /* Which collect call will succeed is a property of the bid's disposition, which the
     anchors do not carry, so it has to be read. Hooks cannot sit behind the early
     return below, hence the guard inside rather than around. */
  useEffect(() => {
    if (!final || bids.length === 0) return;
    let live = true;
    void Promise.all(bids.map(async (b) => {
      try {
        const st = await readBidState(BigInt(b.auctionId), b.index);
        if (live) setState((s) => ({ ...s, [b.index]: st }));
      } catch {
        if (live) setState((s) => ({ ...s, [b.index]: null }));
      }
    }));
    return () => { live = false; };
  }, [final, auction.terms.auctionId, bids.length]);

  if (!final || bids.length === 0) return null;

  async function run(operation: ClaimOperation, stored: StoredBid) {
    if (!connection) return setErr("Connect a wallet first.");
    if (!railUsable(rail, canPrivate)) {
      return setErr("The private rail is unavailable with this wallet on this network. "
        + "Collect on the public rail instead.");
    }
    if (!(await ensureChain())) return;
    setErr(null); setMsg(null);
    try {
      const bid = toPrivateBid(stored);

      /* The public rail calls the auction directly. It has to exist: a bidder who used
         the public rail has no shielded balance, and routing their refund through the
         pool would demand one to retrieve money they put in publicly. Claiming this way
         reveals nothing new — their address was already on the escrow transfer. */
      if (rail === "public") {
        const id = num.toHex(auction.terms.auctionId);
        const call =
          operation === AuctionOperation.ClaimLot
            ? { contractAddress: config.auctionAddress, entrypoint: "claim_lot",
                calldata: CallData.compile([id, num.toHex(bid.claimSecret), connection.address]) }
            : operation === AuctionOperation.RedeemForfeit
              ? { contractAddress: config.auctionAddress, entrypoint: "redeem_forfeit",
                  calldata: CallData.compile([id, num.toHex(bid.index), num.toHex(bid.claimSecret),
                    num.toHex(redeemWitness(auction.terms, bid, auction.clearingLevel)),
                    connection.address]) }
              : { contractAddress: config.auctionAddress, entrypoint: "claim_refund",
                  calldata: CallData.compile([id, num.toHex(bid.index),
                    num.toHex(bid.claimSecret), connection.address]) };
        const { transaction_hash } = await connection.account.execute(call);
        setMsg(transaction_hash);
        return;
      }

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
      if (rail === "private") noteStrk20Error(e);
      setErr(errText(e));
    }
  }

  return (
    <div className="panel">
      <h3 style={{ fontSize: "var(--step-1)" }}>Collect</h3>
      <div className="rails" style={{ marginBlock: ".8rem" }}>
        <button className={rail === "public" ? "rail on" : "rail"} onClick={() => setRail("public")}>
          <span className="rail-name">Public rail <span className="rail-tag">usual</span></span>
          <span className="note">Straight back to this wallet. Nothing to set up.</span>
        </button>
        <button className={rail === "private" ? "rail on" : "rail"}
                onClick={() => canPrivate && setRail("private")} disabled={!canPrivate}>
          <span className="rail-name">Private rail</span>
          <span className="note">
            {canPrivate
              ? "Comes back as a note inside the pool — no address beside a price."
              : "Needs a wallet that speaks STRK20."}
          </span>
        </button>
      </div>
      <p className="note">
        If you bid on the public rail your address is already on the escrow transfer, so
        collecting that way reveals nothing new. The private rail keeps the return
        unlinked as well.
      </p>
      <div className="stack" style={{ gap: ".5rem", marginTop: ".8rem" }}>
        {bids.map((b) => {
          const st = state[b.index];
          const won = b.index === auction.winnerIndex && auction.status === Status.Finalized;
          return (
            <div className="row" key={b.index}>
              <span className="note">Bid #{b.index}</span>
              {st === undefined ? (
                <span className="note">reading the chain…</span>
              ) : st === null ? (
                /* The read failed. Both buttons come back rather than none: an unreadable
                   chain is a reason to stop guessing, not a reason to lock the user out
                   of their own escrow. */
                <>
                  <button onClick={() => run(AuctionOperation.ClaimRefund, b)}>
                    Refund or surplus
                  </button>
                  <button onClick={() => run(AuctionOperation.RedeemForfeit, b)}>
                    Redeem forfeit
                  </button>
                  <span className="note">Could not read this bid, so both are offered.</span>
                </>
              ) : won ? (
                /* Two separate collections, and the lot is the one that looks like
                   finishing. `finalize` already took the clearing price out of this
                   escrow and paid the seller, so what is left is the winner's surplus —
                   and a winner who claims the lot and leaves reads the screen as done.
                   Both are listed, each with its own state. */
                <div className="stack" style={{ gap: ".45rem", flex: 1 }}>
                  <p className="note" style={{ margin: 0 }}>
                    <b>You won.</b> Two things to collect, and the lot is not both of
                    them. The clearing price already came out of your escrow when the
                    auction was finalized.
                  </p>
                  <div className="row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
                    {auction.lotClaimed ? (
                      <span className="note">1 · Lot — collected</span>
                    ) : (
                      <button className="primary"
                              onClick={() => run(AuctionOperation.ClaimLot, b)}>
                        1 · Claim the lot
                      </button>
                    )}
                    {st.claimed ? (
                      <span className="note">2 · Surplus — collected</span>
                    ) : (
                      <button className={auction.lotClaimed ? "primary" : ""}
                              onClick={() => run(AuctionOperation.ClaimRefund, b)}>
                        2 · Claim your surplus
                        {st.escrow > 0n
                          ? ` · ${formatUnits(st.escrow, auction.paymentDecimals)} ${auction.paymentSymbol}`
                          : ""}
                      </button>
                    )}
                  </div>
                  {auction.lotClaimed && !st.claimed && (
                    <p className="note" style={{ margin: 0 }}>
                      The lot is yours. Your surplus is still in the contract — it needs
                      this browser&rsquo;s claim secret, the same one the lot needed.
                    </p>
                  )}
                </div>
              ) : st.claimed ? (
                <span className="note">Already collected.</span>
              ) : (
                <button className="primary"
                        onClick={() => run(collectOp(st, auction.status), b)}>
                  {collectLabel(st, auction.status)}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {Object.values(state).some((s) => s?.disposition === Disposition.Forfeit) && (
        <p className="note" style={{ marginTop: ".8rem" }}>
          A bid marked <b>forfeited</b> is one the auctioneer settled without a seed from
          you. Redeeming serves the loser-side proof yourself and returns the escrow in
          full — late, not lost.
        </p>
      )}
      {msg && <p className="ok mono">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── abandon ─────────────────────────────────────────────────────────── */

/**
 * Cancels a sealed auction whose auctioneer never settled it.
 *
 * Permissionless, and shown to anyone looking at the auction rather than only to the
 * auctioneer — the entire point is that it works when the auctioneer has gone. It
 * renders only once the grace has actually expired, so it is never a button that exists
 * solely to refuse.
 */
export function AbandonPanel({
  auction, connection, now, onDone,
}: {
  auction: AuctionView;
  connection: Connection | null;
  now: number;
  onDone: () => void;
}) {
  const { ensureChain } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auction.status !== Status.Sealed) return null;
  const graceEnds = auction.sealedAtTime + auction.disputeWindow;
  if (!auction.sealedAtTime || now < graceEnds) return null;

  async function abandon() {
    if (!connection) return setErr("Connect a wallet first.");
    if (!(await ensureChain())) return;
    setErr(null); setBusy(true);
    try {
      const res = await connection.account.execute({
        contractAddress: config.auctionAddress,
        entrypoint: "abandon",
        calldata: [auction.terms.auctionId.toString()],
      });
      setMsg(res.transaction_hash);
      onDone();
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel accent">
      <p className="eyebrow">Never settled</p>
      <p style={{ marginTop: ".5rem" }}>
        The auctioneer&rsquo;s time to settle ran out {countdown(graceEnds, now) ?? ""}
        ago — it ended {utcDate(graceEnds)}.
      </p>
      <p className="note" style={{ marginTop: ".5rem" }}>
        <b>Anyone can cancel it now.</b> Every bidder is refunded in full and takes an
        equal share of the auctioneer&rsquo;s forfeited bond; the lot goes back to the
        seller. Nothing is sold, no outcome is recorded, and it cannot be undone.
      </p>
      <div className="row" style={{ gap: ".6rem", marginTop: "1rem" }}>
        <button className="primary" onClick={() => void abandon()} disabled={busy || !connection}>
          {busy ? "Waiting for your wallet…" : "Abandon the auction"}
        </button>
      </div>
      {msg && <p className="note mono" style={{ marginTop: ".6rem", wordBreak: "break-all" }}>{msg}</p>}
      {err && <p className="err" style={{ marginTop: ".6rem" }}>{err}</p>}
    </div>
  );
}
