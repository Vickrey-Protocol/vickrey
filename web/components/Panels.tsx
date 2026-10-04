"use client";

import { useEffect, useState } from "react";
import type { Call } from "starknet";
import {
  Disposition,
  NO_WINNER,
  Status,
  createBid,
  ephemeralScalar,
  readWalletError,
  redeemWitness,
  sealReveal,
  type SealedReveal,
} from "@vickrey/client";
import {
  abandonAt, bidIndexOf, isRevealPosted, provider, readBidState, readPrivateCollect,
  revealDeadline, type AuctionView, type BidState,
} from "@/lib/chain";
import {
  STRK_DECIMALS, config, countdown, formatUnits, hasAnonymizer, priceAt, shortAddr, utcDate,
} from "@/lib/config";
import {
  VaultWriteError, backupOf, markRevealed, reindexBid, saveBid, toPrivateBid,
  vaultWritable, type StoredBid,
} from "@/lib/vault";
import { railUsable, submitBlocked, type Rail } from "@/lib/rails";
import { canDispute, unreadCandidates } from "@/lib/dispute";
import { receiptOutcome, shortRevert } from "@/lib/receipt";
import { confirmBid, type BidVerdict } from "@/lib/bidConfirm";
import { relay } from "@/lib/relay";
import {
  DeliveryOutcome, LotKind, collectActionsV2, collectCall, collectNotes, disputeCall,
  placeBidActionsV2, placeBidCalls, postRevealCall, redeemActionsV2, redeemForfeitCall,
  simpleCall, type PrivateCollect,
} from "@/lib/v2";
import { withTimeout, WAIT } from "@/lib/waiting";
import { sameAddress, type Connection } from "@/lib/wallet";
import { Ladder } from "./Ladder";
import { useWallet } from "@/components/WalletProvider";

/**
 * Never `String(e)` on a wallet error: a JSON-RPC error is a plain object, so that
 * yields "[object Object]" and discards the code. `readWalletError` maps the spec's
 * codes to sentences and says plainly when it does not recognise one.
 */
const errText = (e: unknown) => {
  const err = readWalletError(e);
  return err.recognised || err.code !== null
    ? (err.recognised ? err.say : `${err.say} Raw: ${err.raw}`)
    : (e instanceof Error ? e.message : err.raw);
};

/**
 * Hands the bidder a file holding the whole entry, in the shape the vault's own import
 * accepts, so the copy that leaves the browser is a copy that can come back.
 */
const downloadBackup = (b: StoredBid) => {
  const url = URL.createObjectURL(new Blob([backupOf(b)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `vickrey-bid-${b.auctionId}-${b.index}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const keyOf = (a: AuctionView) => ({ x: a.revealKeyX, y: a.revealKeyY });
const sealedFor = (a: AuctionView, b: StoredBid): SealedReveal =>
  sealReveal(keyOf(a), a.terms.auctionId, b.index, BigInt(b.seed), b.level);

/**
 * Sends calls from the connected wallet and reports what the chain did with them.
 *
 * `preflight` runs each call as a read first. A collect carries the claim secret in
 * calldata, and a transaction that reverts still publishes its calldata — so a collect
 * that would fail must never be sent.
 */
async function sendAndWait(
  connection: Connection, calls: Call[], opts: { preflight?: boolean } = {},
): Promise<{ hash: string; outcome: "succeeded" | "reverted" | "unknown"; reason?: string }> {
  if (opts.preflight) {
    for (const c of calls) await provider().callContract(c);
  }
  const { transaction_hash } = await connection.account.execute(calls);
  try {
    const outcome = receiptOutcome(await provider().waitForTransaction(transaction_hash));
    return outcome.kind === "reverted"
      ? { hash: transaction_hash, outcome: "reverted", reason: shortRevert(outcome.reason) }
      : { hash: transaction_hash, outcome: outcome.kind };
  } catch {
    return { hash: transaction_hash, outcome: "unknown" };
  }
}

const said = (r: { hash: string; outcome: string; reason?: string }, done: string) =>
  r.outcome === "succeeded" ? `${done} Transaction ${r.hash}.`
    : r.outcome === "reverted" ? `The transaction reverted on chain${r.reason ? ` (${r.reason})` : ""}. Nothing changed. Transaction ${r.hash}.`
      : `Sent ${r.hash}. Its receipt could not be read yet — this screen updates once the chain shows it.`;

/* ── bidding ─────────────────────────────────────────────────────────── */

type Shielded =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "enough"; fee: bigint; collateral: bigint }
  | { kind: "short"; have: bigint; need: bigint; feeToken: boolean }
  | { kind: "unknown"; why: string };

type BidPhase =
  | { kind: "form" }
  | { kind: "confirming"; walletSaid: string | null; elapsed: number }
  | { kind: "placed"; bid: StoredBid; txHash?: string }
  | { kind: "verdict"; verdict: Exclude<BidVerdict, { kind: "placed" }>; txHash?: string };

export function BidPanel({
  auction, connection, now, onPlaced,
}: {
  auction: AuctionView;
  connection: Connection | null;
  now: number;
  onPlaced: () => void;
}) {
  const { ensureChain, strk20Proof, noteStrk20Error, retryStrk20 } = useWallet();
  const [level, setLevel] = useState<number | null>(null);
  const [rail, setRail] = useState<Rail>("public");
  /* Every change of rail the bidder did not make is announced, with its reason. */
  const [railNote, setRailNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<BidPhase>({ kind: "form" });
  const [ack, setAck] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [shielded, setShielded] = useState<Shielded>({ kind: "idle" });
  const [storable, setStorable] = useState(true);
  useEffect(() => { setStorable(vaultWritable()); }, []);

  const offchain = auction.lotKind === LotKind.OffChain;
  const canPrivate = !!connection?.strk20Declared && hasAnonymizer() && strk20Proof !== "failed";
  const fee = auction.poolFee;
  const payIsStrk = BigInt(auction.paymentToken) === BigInt(config.strkAddress);

  useEffect(() => {
    if (!canPrivate && rail === "private") {
      setRail("public");
      setRailNote(strk20Proof === "failed"
        ? `Switched to the public rail. Your wallet said it can’t use the privacy pool on ${config.label}, so the private rail is off for now. A wallet that times out or doesn’t answer never switches your rail.`
        : "Switched to the public rail. This wallet doesn’t advertise STRK20 support.");
    }
  }, [canPrivate, rail, strk20Proof]);

  /**
   * The shielded balance must cover the pool fee and the collateral before the wallet is
   * asked, or the bidder learns it from a greyed-out Confirm. A wallet that does not
   * answer is an unknown: nothing is sent, and nothing is guessed.
   */
  async function checkShielded() {
    if (!connection || fee === null) return;
    setShielded({ kind: "checking" });
    const tokens = payIsStrk ? [config.strkAddress] : [config.strkAddress, auction.paymentToken];
    const got = await withTimeout(connection.account.strk20Balances(tokens), WAIT.balance);
    if (got.outcome === "no-answer") {
      return setShielded({ kind: "unknown", why: `Your wallet didn’t answer when asked for your shielded balance, so we can’t tell whether it covers this bid’s ${payIsStrk ? `${formatUnits(fee + auction.collateral, STRK_DECIMALS)} STRK` : "fee and collateral"}.` });
    }
    if (got.outcome === "failed") {
      noteStrk20Error(got.error);
      return setShielded({ kind: "unknown", why: errText(got.error) });
    }
    const bal = (t: string) => {
      const hit = got.value.find((e) => BigInt(e.token) === BigInt(t));
      return hit ? BigInt(hit.balance) : 0n;
    };
    if (payIsStrk) {
      const need = fee + auction.collateral;
      const have = bal(config.strkAddress);
      return setShielded(have >= need
        ? { kind: "enough", fee, collateral: auction.collateral }
        : { kind: "short", have, need, feeToken: true });
    }
    if (bal(config.strkAddress) < fee) {
      return setShielded({ kind: "short", have: bal(config.strkAddress), need: fee, feeToken: true });
    }
    if (bal(auction.paymentToken) < auction.collateral) {
      return setShielded({ kind: "short", have: bal(auction.paymentToken), need: auction.collateral, feeToken: false });
    }
    setShielded({ kind: "enough", fee, collateral: auction.collateral });
  }
  useEffect(() => { setShielded({ kind: "idle" }); }, [rail, connection?.address]);

  const closed = now >= auction.bidDeadline;
  const privateReady = rail !== "private" || shielded.kind === "enough";

  async function submit() {
    if (!connection) return setError("Connect a wallet first.");
    if (level === null) return setError("Pick a level on the ladder.");
    if (offchain && !understood) return setError("Tick the box first: this lot depends on the seller.");
    if (!railUsable(rail, canPrivate)) return setError("The private rail is unavailable with this wallet.");
    if (!(await ensureChain())) return;
    setError(null);
    const guessed = auction.bidCount;
    let stored: StoredBid;
    let bid: ReturnType<typeof createBid>;
    try {
      bid = createBid(auction.terms, level);
      /* Written before the send: a transaction that lands while the secret does not is
         an escrow nobody can release. */
      stored = saveBid(auction.terms.auctionId, bid, guessed);
    } catch (e) {
      return setError(e instanceof VaultWriteError ? e.message : errText(e));
    }

    let txHash: string | undefined;
    let walletSaid: string | null = null;
    try {
      if (rail === "public") {
        setBusy("Waiting for your wallet…");
        ({ transaction_hash: txHash } = await connection.account.execute(placeBidCalls(
          auction.contract, auction.paymentToken, auction.collateral, auction.terms.auctionId,
          bid.claimCommitment, bid.upAnchor, bid.downAnchor)));
      } else {
        const actions = placeBidActionsV2(config.anonymizerAddress, auction.paymentToken,
          auction.collateral, auction.terms.auctionId, bid.claimCommitment, bid.upAnchor, bid.downAnchor);
        setBusy("Checking the transaction shape…");
        await connection.account.strk20PrepareInvoke(actions, true);
        setBusy("Proving. This takes about 30 seconds — the wallet is not stuck.");
        ({ transaction_hash: txHash } = await connection.account.strk20InvokeTransaction(actions));
      }
    } catch (e) {
      if (rail === "private") noteStrk20Error(e);
      walletSaid = errText(e);
    } finally {
      setBusy(null);
    }

    /* Whatever the wallet said, the auction is asked. */
    setPhase({ kind: "confirming", walletSaid, elapsed: 0 });
    const verdict = await confirmBid({
      indexOf: () => bidIndexOf(auction, bid.upAnchor),
      bidAt: async (i) => {
        const r = await provider().callContract({ contractAddress: auction.contract,
          entrypoint: "get_bid", calldata: [auction.terms.auctionId.toString(), String(i)] });
        return { commitment: BigInt(r[0]!), downAnchor: BigInt(r[2]!) };
      },
      stillOpen: async () => {
        const st = await provider().callContract({ contractAddress: auction.contract,
          entrypoint: "get_state", calldata: [auction.terms.auctionId.toString()] });
        return Number(BigInt(st[0]!)) === Status.Open && Date.now() / 1000 < auction.bidDeadline;
      },
      receipt: txHash ? async () => {
        const o = receiptOutcome(await provider().getTransactionReceipt(txHash!));
        return o.kind === "reverted" ? { reverted: shortRevert(o.reason) } : o.kind;
      } : undefined,
    }, { commitment: bid.claimCommitment, downAnchor: bid.downAnchor },
    { onTick: (ms) => setPhase({ kind: "confirming", walletSaid, elapsed: Math.floor(ms / 1000) }) });

    if (verdict.kind === "placed") {
      reindexBid(auction.terms.auctionId, bid.claimCommitment, verdict.index);
      setPhase({ kind: "placed", bid: { ...stored, index: verdict.index, txHash }, txHash });
      onPlaced();
    } else {
      setPhase({ kind: "verdict", verdict, txHash });
    }
  }

  if (phase.kind === "confirming") {
    return (
      <div className="stack">
        <div className="spread"><h3 style={{ fontSize: "var(--step-1)" }}>Looking for your bid</h3>
          <span className="countdown">0:{String(phase.elapsed).padStart(2, "0")}</span></div>
        <p>{phase.walletSaid
          ? <>Your wallet said: <i>{phase.walletSaid.replace(/[.!?]?\s*$/, ".")}</i> That doesn’t always mean it failed — we’re checking the auction itself for your bid.</>
          : "Checking the auction itself for your bid."}</p>
        <p className="note">Your claim secret is already saved in this browser.</p>
        <button disabled>Bid again — wait for the chain</button>
      </div>
    );
  }

  if (phase.kind === "verdict") {
    const v = phase.verdict;
    return (
      <div className="stack">
        {v.kind === "reverted" && <>
          <h3 style={{ fontSize: "var(--step-1)", color: "var(--seal)" }}>The transaction reverted</h3>
          <p>No bid was placed and no escrow moved. Reason: <span className="mono">{v.reason}</span>.</p>
        </>}
        {v.kind === "absent" && <>
          <h3 style={{ fontSize: "var(--step-1)" }}>No bid landed — it’s safe to try again</h3>
          <p>We checked the auction for 90 seconds and no bid carries your commitment. No escrow moved.</p>
        </>}
        {v.kind === "closed" && <>
          <h3 style={{ fontSize: "var(--step-1)" }}>Not placed</h3>
          <p>No bid carries your commitment, and bidding has now closed.</p>
        </>}
        {v.kind === "unknown" && <>
          <h3 style={{ fontSize: "var(--step-1)" }}>We couldn’t reach the chain</h3>
          <p>So we can’t say whether your bid landed. We won’t guess either way. Keep this tab open; the dashboard keeps checking. ({v.why})</p>
        </>}
        {phase.txHash && <p className="note mono">tx {phase.txHash}</p>}
        <div className="row">
          {(v.kind === "absent" || v.kind === "reverted") && (
            <button className="primary" onClick={() => setPhase({ kind: "form" })}>Bid again</button>
          )}
          {v.kind === "unknown" && <button disabled>Bid again — wait for the chain</button>}
        </div>
      </div>
    );
  }

  if (phase.kind === "placed") {
    const placed = phase.bid;
    return (
      <div className="secret">
        <div className="okbox" style={{ marginBottom: ".9rem" }}>
          <b>Placed — bid #{placed.index} is on chain.</b>
          <p className="note" style={{ margin: ".3rem 0 0" }}>
            The auction holds your bid and its escrow. Save your claim secret next.
          </p>
        </div>
        <h3 style={{ fontSize: "var(--step-1)", marginBottom: ".4rem" }}>Save your claim secret</h3>
        <p className="note" style={{ color: "var(--ink-soft)" }}>
          It’s the only thing that collects your escrow or the lot. It is not on any server and
          there is no recovery.
        </p>
        <div className="value">{placed.claimSecret}</div>
        <p className="note" style={{ color: "var(--ink-soft)" }}>
          After bidding closes, your bid is revealed to the auctioneer from this browser, using
          the seed in this backup. Keep the download: it restores through <b>My bids → Import</b>.
        </p>
        <div className="row">
          <button onClick={() => navigator.clipboard?.writeText(placed.claimSecret)}>Copy secret</button>
          <button onClick={() => downloadBackup(placed)}>Download backup</button>
          <label style={{ display: "flex", gap: ".45rem", alignItems: "center", margin: 0 }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: "auto" }} />
            I have saved it
          </label>
          <button className="primary" disabled={!ack} onClick={() => setPhase({ kind: "form" })}>Continue</button>
        </div>
        {phase.txHash && <p className="note mono" style={{ marginTop: ".7rem" }}>{phase.txHash}</p>}
      </div>
    );
  }

  const needLine = fee === null ? null : payIsStrk
    ? <>This bid needs <b className="mono">{formatUnits(fee + auction.collateral, STRK_DECIMALS)} STRK</b> in your shielded balance: <span className="mono">{formatUnits(fee, STRK_DECIMALS)}</span> pool fee + <span className="mono">{formatUnits(auction.collateral, auction.paymentDecimals)}</span> collateral.</>
    : <>This bid needs <b className="mono">{formatUnits(fee, STRK_DECIMALS)} STRK</b> shielded for the pool fee and <b className="mono">{formatUnits(auction.collateral, auction.paymentDecimals)} {auction.paymentSymbol}</b> shielded for the collateral.</>;

  return (
    <div className="stack">
      <div>
        <h3 style={{ fontSize: "var(--step-1)" }}>Place a bid</h3>
        <p className="note">
          Pick a level. Everyone escrows the same {formatUnits(auction.collateral, auction.paymentDecimals)}{" "}
          {auction.paymentSymbol}, which is what stops the escrow saying anything about the bid
          behind it. The losing bids are never published.
        </p>
      </div>

      <div className="rails">
        <button className={rail === "public" ? "rail on" : "rail"}
                onClick={() => { setRail("public"); setRailNote(null); }} aria-pressed={rail === "public"}>
          <span className="rail-name">Public rail <span className="rail-tag">usual</span></span>
          <span className="note">Bid straight from this wallet. Nothing to set up.</span>
          <span className="rail-cost">gas only</span>
        </button>
        <button className={rail === "private" ? "rail on" : "rail"}
                onClick={() => { if (canPrivate) { setRail("private"); setRailNote(null); } }}
                disabled={!canPrivate} aria-pressed={rail === "private"}>
          <span className="rail-name">Private rail</span>
          <span className="note">
            {canPrivate ? "Also hides your address. Needs a shielded balance first."
              : connection && !connection.strk20Declared ? "This wallet does not advertise STRK20 support."
                : strk20Proof === "failed" ? `Your wallet said it can’t use the privacy pool on ${config.label}.`
                  : "No anonymizer configured."}
          </span>
          <span className="rail-cost">
            {fee === null ? "pool fee + gas" : `${formatUnits(fee, STRK_DECIMALS)} STRK pool fee + gas`}
          </span>
        </button>
      </div>
      {railNote && (
        <div className="note" role="status">
          <p style={{ margin: 0 }}>{railNote}</p>
          {strk20Proof === "failed" && connection?.strk20Declared && (
            <button type="button" style={{ marginTop: ".5rem" }}
                    onClick={() => { retryStrk20(); setRailNote(null); setRail("private"); }}>
              Try the private rail again
            </button>
          )}
        </div>
      )}

      {rail === "private" && canPrivate && (
        <div className="panel" style={{ background: "var(--hatch-bg)" }}>
          <p className="eyebrow">Before this will work</p>
          {needLine && <p style={{ marginTop: ".4rem" }}>{needLine}</p>}
          <p className="note" style={{ marginTop: ".4rem" }}>
            Shield in your wallet first — shielding has its own pool fee. When the wallet sends
            the collateral, it warns “Withdraw recipient is not your address”: that’s expected,
            the collateral goes to Vickrey’s contract.
          </p>
          {shielded.kind === "idle" && (
            <button style={{ marginTop: ".6rem" }} onClick={() => void checkShielded()}>Check my shielded balance</button>
          )}
          {shielded.kind === "checking" && <p className="note">Asking your wallet…</p>}
          {shielded.kind === "enough" && <p className="ok">Your shielded balance covers it.</p>}
          {shielded.kind === "short" && (
            <p style={{ marginTop: ".5rem" }}>
              You have <b className="mono">{formatUnits(shielded.have, shielded.feeToken ? STRK_DECIMALS : auction.paymentDecimals)}{shielded.feeToken ? " STRK" : ` ${auction.paymentSymbol}`}</b> shielded.
              Shield <b className="mono">{formatUnits(shielded.need - shielded.have, shielded.feeToken ? STRK_DECIMALS : auction.paymentDecimals)}</b> more
              in your wallet first — shielding has its own pool fee.
              <button style={{ marginLeft: ".6rem" }} onClick={() => void checkShielded()}>Check again</button>
            </p>
          )}
          {shielded.kind === "unknown" && (
            <p style={{ marginTop: ".5rem" }}>
              {shielded.why} We won’t guess. Nothing has been sent.
              <button style={{ marginLeft: ".6rem" }} onClick={() => void checkShielded()}>Check again</button>
            </p>
          )}
        </div>
      )}

      <div className="bid-grid">
        <Ladder
          numLevels={auction.terms.numLevels} reservePrice={auction.terms.reservePrice}
          tick={auction.terms.tick} symbol={auction.paymentSymbol} decimals={auction.paymentDecimals}
          bidCount={auction.bidCount} status={auction.status} pickedLevel={level} onPick={setLevel}
        />
        <div className="stack" style={{ gap: ".9rem" }}>
          <dl className="facts">
            <div className="fact"><dt>Your bid</dt><dd>
              {level === null ? "—" : <><span className="price" style={{ fontSize: "1.6rem" }}>
                {formatUnits(priceAt(auction.terms, level), auction.paymentDecimals)}</span> {auction.paymentSymbol}</>}
            </dd></div>
            <div className="fact"><dt>You escrow</dt>
              <dd>{formatUnits(auction.collateral, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>
          </dl>

          {offchain && (
            <label className="warnbox" style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)}
                     style={{ width: "1.2rem", height: "1.2rem", marginTop: ".15rem", flex: "none" }} />
              <span>I understand this lot depends on the seller.</span>
            </label>
          )}

          {!storable && (
            <p className="note" role="alert" style={{ color: "var(--bad, #b4341f)" }}>
              <b>This browser will not keep your claim secret.</b> Bidding is disabled, because
              the secret is stored before the transaction is sent. Allow site data for this
              site in a normal window and reload.
            </p>
          )}

          <div className="row">
            <button className="primary" onClick={() => void submit()}
                    disabled={closed || (offchain && !understood) || !privateReady
                      || submitBlocked({ rail, canPrivate, busy: !!busy, connected: !!connection, storable })}>
              {busy ? "Working…" : rail === "private" ? "Bid privately" : "Place sealed bid"}
            </button>
            <span className="note">
              {busy ?? (offchain && !understood ? "Tick the box above first."
                : rail === "private" && !privateReady ? "Check your shielded balance first."
                  : rail === "private" ? "Proving takes about 30 seconds." : "One transaction: approve, then place.")}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="err">{error}</p>}
    </div>
  );
}

/* ── reveal ──────────────────────────────────────────────────────────── */

type RevealState =
  | { kind: "checking" }
  | { kind: "posted"; tx?: string }
  | { kind: "posting" }
  | { kind: "relay-failed"; why: string }
  | { kind: "self"; busy?: boolean; err?: string }
  | { kind: "unknown"; why: string };

/**
 * After the seal, each bid is revealed on chain, encrypted to the auctioneer's key for
 * this auction — by the relay, so the bidder's wallet is not attached, or by the bidder.
 * A posted reveal is both what lets the bid be settled and, if the settlement leaves it
 * out, the proof that the auctioneer had it.
 */
export function RevealPanel({
  auction, bids, connection, now,
}: { auction: AuctionView; bids: StoredBid[]; connection: Connection | null; now: number }) {
  const [state, setState] = useState<Record<number, RevealState>>({});
  const deadline = revealDeadline(auction);
  const open = auction.status === Status.Sealed && now < deadline;
  const key = bids.map((b) => b.index).join(",");

  /** One relay attempt. The chain decides, not the relay's answer: a request can fail
      after an earlier one for the same reveal landed. Never "not posted" without asking. */
  async function viaRelay(b: StoredBid): Promise<RevealState> {
    const sealed = sealedFor(auction, b);
    const r = await relay({ kind: "reveal", auctionId: auction.terms.auctionId.toString(),
      bidIndex: b.index, ephX: sealed.ephX.toString(), cSeed: sealed.cSeed.toString(),
      cLevel: sealed.cLevel.toString() });
    const landed = r.ok || await isRevealPosted(auction, b.index, sealed).catch(() => false);
    if (!landed) return { kind: "relay-failed", why: r.ok ? "" : r.why };
    markRevealed(auction.terms.auctionId, b.index);
    return { kind: "posted", tx: r.ok && r.tx ? r.tx : undefined };
  }

  useEffect(() => {
    if (auction.status !== Status.Sealed || !bids.length) return;
    let live = true;
    /* Every bid at once: the relay queues them and finishes each on its side, so a page
       closed after the first reveal lands still gets the others posted. */
    void Promise.all(bids.map(async (b) => {
      const sealed = sealedFor(auction, b);
      let posted: boolean;
      try { posted = await isRevealPosted(auction, b.index, sealed); }
      catch (e) {
        if (live) setState((s) => ({ ...s, [b.index]: { kind: "unknown", why: errText(e) } }));
        return;
      }
      if (!live) return;
      if (posted) {
        markRevealed(auction.terms.auctionId, b.index);
        setState((s) => ({ ...s, [b.index]: { kind: "posted" } }));
        return;
      }
      if (Date.now() / 1000 >= deadline) return;
      if (!config.relay) { setState((s) => ({ ...s, [b.index]: { kind: "self" } })); return; }
      setState((s) => ({ ...s, [b.index]: { kind: "posting" } }));
      const next = await viaRelay(b);
      if (live) setState((s) => ({ ...s, [b.index]: next }));
    }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction.status, auction.terms.auctionId, key, deadline]);

  /* A reveal the relay didn't post is tried again every minute until the window closes.
     A failed request costs the relay nothing and counts against no cap. */
  const failing = bids.filter((b) => state[b.index]?.kind === "relay-failed");
  useEffect(() => {
    if (!open || !config.relay || failing.length === 0) return;
    let live = true;
    const t = setTimeout(() => {
      void (async () => {
        for (const b of failing) {
          const next = await viaRelay(b);
          if (!live) return;
          setState((s) => (s[b.index]?.kind === "relay-failed" ? { ...s, [b.index]: next } : s));
        }
      })();
    }, 60_000);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  if (auction.status !== Status.Sealed || bids.length === 0) return null;

  async function retryNow(b: StoredBid) {
    setState((s) => ({ ...s, [b.index]: { kind: "posting" } }));
    const next = await viaRelay(b);
    setState((s) => ({ ...s, [b.index]: next }));
  }

  async function postMyself(b: StoredBid) {
    if (!connection) return setState((s) => ({ ...s, [b.index]: { kind: "self", err: "Connect a wallet first." } }));
    setState((s) => ({ ...s, [b.index]: { kind: "self", busy: true } }));
    try {
      const r = await sendAndWait(connection, [postRevealCall(auction.contract, auction.terms.auctionId, b.index, sealedFor(auction, b))]);
      if (r.outcome === "reverted") throw new Error(said(r, ""));
      markRevealed(auction.terms.auctionId, b.index);
      setState((s) => ({ ...s, [b.index]: { kind: "posted", tx: r.hash } }));
    } catch (e) {
      setState((s) => ({ ...s, [b.index]: { kind: "self", err: errText(e) } }));
    }
  }

  return (
    <div className="panel">
      <div className="spread">
        <h3 style={{ fontSize: "var(--step-1)" }}>Reveal your bid</h3>
        {open && <span className="countdown">window closes in {countdown(deadline, now)}</span>}
      </div>
      <p className="note" style={{ marginTop: ".4rem" }}>
        Bidding has closed and the bid set is sealed. Your bid goes on chain now, encrypted to
        the auctioneer’s key for this auction: the auctioneer can read it and nobody else can.
        Revealing is what lets your bid be settled.
      </p>
      <div className="stack" style={{ gap: ".7rem", marginTop: ".8rem" }}>
        {bids.map((b) => {
          const s = state[b.index] ?? { kind: "checking" };
          if (s.kind === "posted") {
            return (
              <div key={b.index} className="okbox">
                <b>Bid #{b.index} is revealed on chain.</b> Encrypted to the auctioneer. It’s also
                your proof, if it’s ever needed, that the auctioneer had your bid.
                {s.tx && <span className="note mono" style={{ display: "block" }}>tx {s.tx}</span>}
              </div>
            );
          }
          if (!open) {
            return (
              <div key={b.index}>
                <b>Bid #{b.index} wasn’t revealed in time.</b> The auctioneer couldn’t settle it, so
                it will be recorded as forfeited. If it was at or below the clearing price, you can
                redeem the escrow once the auction is final. If it was above, the escrow stays in
                the contract.
              </div>
            );
          }
          if (s.kind === "checking") return <p key={b.index} className="note">Checking bid #{b.index}…</p>;
          if (s.kind === "posting") {
            return <p key={b.index}><b>Posting your reveal for bid #{b.index}…</b> Sent by Vickrey’s relay, so your wallet isn’t attached to it. Nothing to sign.</p>;
          }
          if (s.kind === "unknown") {
            return <p key={b.index}>Couldn’t check bid #{b.index} on the chain ({s.why}). Reload to try again.</p>;
          }
          return (
            <div key={b.index} className={s.kind === "relay-failed" ? "warnbox" : ""}>
              {s.kind === "relay-failed"
                ? <><b>The relay hasn’t posted your reveal for bid #{b.index}.</b> {s.why ? `It said: ${s.why}.` : "It didn’t respond."} We’ll keep trying until the window closes. You can post it yourself now instead — that puts your wallet address next to bid #{b.index} on chain. Not your amount.</>
                : <><b>Post your reveal for bid #{b.index}.</b> Posting it from your wallet puts your address next to bid #{b.index} on chain. Not your amount.</>}
              <div className="row" style={{ marginTop: ".6rem" }}>
                <button className="primary" disabled={s.kind === "self" && s.busy} onClick={() => void postMyself(b)}>
                  {s.kind === "self" && s.busy ? "Waiting for your wallet…" : "Post it myself"}
                </button>
                {s.kind === "relay-failed" && <button onClick={() => void retryNow(b)}>Keep waiting for the relay</button>}
              </div>
              {s.kind === "self" && s.err && <p className="err">{s.err}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── dispute ─────────────────────────────────────────────────────────── */

/**
 * Shown only for a bid the settlement recorded as forfeited, that changed the result by
 * being left out, and whose reveal was posted on chain in time. The contract asks all
 * three; so does this panel, from the chain, before it offers anything.
 */
export function DisputePanel({
  auction, bids, connection, now,
}: { auction: AuctionView; bids: StoredBid[]; connection: Connection | null; now: number }) {
  const [states, setStates] = useState<Record<number, BidState | null | undefined>>({});
  const [posted, setPosted] = useState<Record<number, boolean | null>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settled = auction.status === Status.Settled;
  const cancelled = auction.status === Status.Cancelled;
  /* After a successful dispute the auction is Cancelled and this panel's question is
     gone; what remains to say is which of my bids won it, read from the escrow the bond
     was credited to. */
  const [voided, setVoided] = useState<Array<{ index: number; escrow: bigint }>>([]);
  const mineKey = bids.map((b) => b.index).join(",");
  useEffect(() => {
    if (!cancelled || !mineKey) return;
    let live = true;
    void Promise.all(bids.map(async (b) => {
      try {
        const st = await readBidState(auction.terms.auctionId, b.index, auction.contract);
        return !st.claimed && st.escrow > auction.collateral ? { index: b.index, escrow: st.escrow } : null;
      } catch { return null; }
    })).then((rows) => { if (live) setVoided(rows.filter((r): r is { index: number; escrow: bigint } => r !== null)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelled, mineKey, auction.terms.auctionId]);
  const candidates = settled ? bids.filter((b) => b.index !== auction.winnerIndex
    && (b.level > auction.clearingLevel || auction.winnerIndex === NO_WINNER)) : [];
  const candidateKey = candidates.map((b) => b.index).join(",");

  useEffect(() => {
    if (!candidateKey) return;
    let live = true;
    void Promise.all(candidates.map(async (b) => {
      try {
        const st = await readBidState(auction.terms.auctionId, b.index, auction.contract);
        const p = await isRevealPosted(auction, b.index, sealedFor(auction, b));
        if (live) { setStates((s) => ({ ...s, [b.index]: st })); setPosted((s) => ({ ...s, [b.index]: p })); }
      } catch {
        if (live) setStates((s) => ({ ...s, [b.index]: null }));
      }
    }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey, auction.terms.auctionId]);

  if (cancelled && voided.length) {
    const fmt = (x: bigint) => formatUnits(x, auction.paymentDecimals);
    return (
      <div className="panel okbox">
        <h3 style={{ fontSize: "var(--step-1)" }}>The settlement is void</h3>
        {voided.map((v) => (
          <div key={v.index} className="stack" style={{ gap: ".6rem" }}>
            <p style={{ margin: 0 }}>
              The auction is cancelled and every bidder can collect their escrow. Bid #{v.index} holds{" "}
              <b className="mono">{fmt(v.escrow - auction.bond)}</b> + <b className="mono">{fmt(auction.bond)}</b> bond.
            </p>
            <div className="row">
              <button className="primary" onClick={() => document.getElementById("collect")?.scrollIntoView({ behavior: "smooth" })}>
                Collect {fmt(v.escrow)} {auction.paymentSymbol}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!settled) return null;
  const eligible = candidates.filter((b) => canDispute(auction, b, states[b.index]) && posted[b.index]);
  const unread = unreadCandidates(auction, candidates, states);
  if (eligible.length === 0 && unread.length === 0) return null;
  const left = countdown(auction.disputeDeadline, now);

  if (eligible.length === 0) {
    return (
      <div className="panel"><p className="note">
        Couldn’t read {unread.map((i) => `bid #${i}`).join(", ")} from the chain to check how the
        settlement recorded it. Reload to try again.
      </p></div>
    );
  }

  async function voidIt(b: StoredBid) {
    setErr(null); setMsg(null); setBusy(true);
    const sealed = sealedFor(auction, b);
    const r = ephemeralScalar(BigInt(b.seed), auction.terms.auctionId, b.index);
    try {
      if (config.relay) {
        const res = await relay({ kind: "dispute", auctionId: auction.terms.auctionId.toString(),
          bidIndex: b.index, r: r.toString(), cSeed: sealed.cSeed.toString(), cLevel: sealed.cLevel.toString() });
        if (res.ok) { setMsg(`The settlement is void. Transaction ${res.tx}.`); return; }
        if (!connection) { setErr(`The relay couldn’t send it (${res.why}). Connect a wallet to send it yourself.`); return; }
      }
      if (!connection) return setErr("Connect a wallet first.");
      const out = await sendAndWait(connection,
        [disputeCall(auction.contract, auction.terms.auctionId, b.index, r, sealed.cSeed, sealed.cLevel)],
        { preflight: true });
      setMsg(said(out, "The settlement is void."));
    } catch (e) {
      setErr(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="panel accent">
      {eligible.map((b) => (
        <div key={b.index} className="stack" style={{ gap: ".6rem" }}>
          <h3 style={{ fontSize: "var(--step-1)" }}>The settlement left your bid out</h3>
          <p>
            The auctioneer recorded bid #{b.index} as forfeited, and {auction.winnerIndex === NO_WINNER
              ? "named no winner at all" : "it was above the clearing price"}. Your reveal was
            posted on chain in time, so you can show the auctioneer had it.
          </p>
          <p>
            Showing it voids the result. The auctioneer’s{" "}
            <b className="mono">{formatUnits(auction.bond, auction.paymentDecimals)} {auction.paymentSymbol}</b>{" "}
            bond is added to your escrow, and you collect both with your claim secret.
          </p>
          <p className="note">This opens your reveal, so your bid on this auction becomes public. The auction is cancelled either way.</p>
          <div className="row">
            <button className="primary" onClick={() => void voidIt(b)} disabled={!left || busy}>
              {busy ? "Sending…" : "Void the settlement"}
            </button>
            <span className="note">{left ? <>Window closes in <span className="countdown">{left}</span></> : "The window has closed."}</span>
          </div>
          {config.relay && <p className="note">Sent through Vickrey’s relay, so your wallet isn’t attached.</p>}
        </div>
      ))}
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── collect ─────────────────────────────────────────────────────────── */

/** A forfeited bid on a finalized auction redeems by proof; anything else collects. */
export const isForfeit = (st: BidState, status: Status) =>
  status === Status.Finalized && st.disposition === Disposition.Forfeit;

export const collectMode = (st: BidState, status: Status): "collect" | "redeem" =>
  isForfeit(st, status) ? "redeem" : "collect";

/**
 * A forfeited bid on a finalized auction can be redeemed only by proving it sat at or
 * below the clearing price. Above it there is no such proof, so no call will succeed.
 */
export const unredeemable = (st: BidState, status: Status, level: number, clearingLevel: number) =>
  isForfeit(st, status) && level > clearingLevel;

function PrivateUnavailable({ pc, winner, onCheck, onPublic }: {
  pc: PrivateCollect; winner: boolean; onCheck: () => void; onPublic: () => void;
}) {
  if (pc.verdict === "unavailable") {
    return (
      <div className="panel" style={{ background: "var(--hatch-bg)" }}>
        <b>Why there’s no private collect yet</b>
        <p style={{ marginTop: ".4rem" }}>
          The privacy pool screens deposits that come from contracts it hasn’t cleared, and it
          hasn’t cleared Vickrey’s yet. It would refuse a private collect. A refused collect
          would still put your claim secret on chain with nothing collected, so we don’t send one.
        </p>
        <p className="note" style={{ marginTop: ".4rem" }}>
          {winner
            ? "Collecting publicly reveals nothing about your bid: the surplus is the same for any winner. It does link this wallet to the win."
            : "Collecting publicly reveals nothing about your bid: every bid escrowed the same amount. It does link this wallet to the bid."}
        </p>
      </div>
    );
  }
  if (pc.verdict === "unknown") {
    return (
      <div className="panel" style={{ background: "var(--hatch-bg)" }}>
        <b>We couldn’t check whether the pool would accept a private collect</b>
        <p style={{ marginTop: ".4rem" }}>
          Reading the pool failed ({pc.why}). We won’t guess, and we won’t send a private collect
          we haven’t checked.
        </p>
        <div className="row" style={{ marginTop: ".6rem" }}>
          <button onClick={onCheck}>Check again</button>
          <button className="primary" onClick={onPublic}>Collect publicly instead</button>
        </div>
      </div>
    );
  }
  return null;
}

export function CollectPanel({
  auction, bids, connection,
}: { auction: AuctionView; bids: StoredBid[]; connection: Connection | null }) {
  const { ensureChain, strk20Proof, noteStrk20Error } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rail, setRail] = useState<Rail>("public");
  const [pc, setPc] = useState<PrivateCollect | null>(null);
  const [state, setState] = useState<Record<number, BidState | null | undefined>>({});
  const [lotTo, setLotTo] = useState("");
  const walletPrivate = !!connection?.strk20Declared && hasAnonymizer() && strk20Proof !== "failed";

  const final = auction.status === Status.Finalized || auction.status === Status.Cancelled;

  useEffect(() => { if (connection && !lotTo) setLotTo(connection.address); }, [connection, lotTo]);
  useEffect(() => {
    if (!final || !walletPrivate) return;
    void readPrivateCollect().then(setPc);
  }, [final, walletPrivate]);
  useEffect(() => {
    if (!final || bids.length === 0) return;
    let live = true;
    void Promise.all(bids.map(async (b) => {
      try {
        const st = await readBidState(auction.terms.auctionId, b.index, auction.contract);
        if (live) setState((s) => ({ ...s, [b.index]: st }));
      } catch { if (live) setState((s) => ({ ...s, [b.index]: null })); }
    }));
    return () => { live = false; };
  }, [final, auction.terms.auctionId, auction.contract, bids.length, msg]);

  if (!final || bids.length === 0) return null;
  const privateOk = walletPrivate && pc?.verdict === "available";
  const winning = auction.status === Status.Finalized ? bids.find((b) => b.index === auction.winnerIndex) : undefined;
  const winState = winning ? state[winning.index] : undefined;
  const noteCount = winning
    ? collectNotes({ paymentToken: auction.paymentToken, paymentOut: winState?.escrow ?? 0n, isWinner: true,
      lotKind: auction.lotKind, lotToken: auction.lotToken, lotAmount: auction.lotAmount }).length
    : 1;
  const notesLine = noteCount === 2 ? "Two private notes in your shielded balance. No address."
    : "A private note in your shielded balance. No address.";

  async function run(b: StoredBid, st: BidState | null) {
    if (!connection) return setErr("Connect a wallet first.");
    if (!(await ensureChain())) return;
    setErr(null); setMsg(null); setBusy(true);
    const bid = toPrivateBid(b);
    const wins = auction.status === Status.Finalized && b.index === auction.winnerIndex;
    const needsLotAddress = wins && auction.lotKind !== LotKind.Erc20;
    const lotRecipient = needsLotAddress ? lotTo.trim() : connection.address;
    try {
      if (needsLotAddress && !/^0x[0-9a-fA-F]{1,64}$/.test(lotRecipient)) {
        throw new Error("Enter the address the lot should go to.");
      }
      const redeem = st !== null && collectMode(st, auction.status) === "redeem";
      const witness = redeem ? redeemWitness(auction.terms, bid, auction.clearingLevel) : 0n;

      if (rail === "private") {
        /* Read again right before the wallet opens: the answer on screen may be old. */
        const fresh = await readPrivateCollect();
        setPc(fresh);
        if (fresh.verdict !== "available") throw new Error("A private collect isn’t available right now — see the note above.");
        const actions = redeem
          ? redeemActionsV2({ helper: config.anonymizerAddress, owner: connection.address,
            paymentToken: auction.paymentToken, auctionId: auction.terms.auctionId, bidIndex: b.index,
            claimSecret: bid.claimSecret, witnessDown: witness })
          : collectActionsV2({ helper: config.anonymizerAddress, owner: connection.address,
            auctionId: auction.terms.auctionId, bidIndex: b.index, claimSecret: bid.claimSecret,
            paymentToken: auction.paymentToken, lotRecipient: needsLotAddress ? lotRecipient : undefined,
            notes: collectNotes({ paymentToken: auction.paymentToken, paymentOut: st?.escrow ?? 0n,
              isWinner: wins, lotKind: auction.lotKind, lotToken: auction.lotToken, lotAmount: auction.lotAmount }) });
        /* The auction call itself, as a read, so a collect that would fail is never handed
           to the pool — a refused one would still publish the claim secret. */
        await provider().callContract(redeem
          ? redeemForfeitCall(auction.contract, auction.terms.auctionId, b.index, bid.claimSecret, witness, config.anonymizerAddress)
          : collectCall(auction.contract, auction.terms.auctionId, b.index, bid.claimSecret, config.anonymizerAddress,
            needsLotAddress ? lotRecipient : config.anonymizerAddress));
        const { transaction_hash } = await connection.account.strk20InvokeTransaction(actions);
        setMsg(`Sent ${transaction_hash}. It lands as private notes in your shielded balance.`);
        return;
      }
      const call = redeem
        ? redeemForfeitCall(auction.contract, auction.terms.auctionId, b.index, bid.claimSecret, witness, connection.address)
        : collectCall(auction.contract, auction.terms.auctionId, b.index, bid.claimSecret, connection.address, lotRecipient);
      setMsg(said(await sendAndWait(connection, [call], { preflight: true }), "Collected."));
    } catch (e) {
      if (rail === "private") noteStrk20Error(e);
      setErr(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="panel" id="collect">
      <h3 style={{ fontSize: "var(--step-1)" }}>Collect</h3>
      <div className="rails" style={{ marginBlock: ".8rem" }}>
        <button className={rail === "public" ? "rail on" : "rail"} onClick={() => setRail("public")}>
          <span className="rail-name">Public rail</span>
          <span className="note">To this wallet’s address.</span>
        </button>
        <button className={rail === "private" ? "rail on" : "rail"} disabled={!privateOk}
                onClick={() => privateOk && setRail("private")}>
          <span className="rail-name">Private rail{walletPrivate && pc && pc.verdict !== "available" ? " · unavailable" : ""}</span>
          <span className="note">
            {!walletPrivate ? "Needs a wallet that speaks STRK20."
              : pc === null ? "Checking the pool…"
                : pc.verdict === "available" ? notesLine
                  : "See below."}
          </span>
        </button>
      </div>
      {walletPrivate && pc && pc.verdict !== "available" && (
        <PrivateUnavailable pc={pc} winner={!!winning} onCheck={() => { setPc(null); void readPrivateCollect().then(setPc); }}
                            onPublic={() => setRail("public")} />
      )}
      {rail === "private" && privateOk && (
        <dl className="facts" style={{ marginTop: ".8rem" }}>
          {winning && winState && <div className="fact"><dt>Surplus</dt>
            <dd>{formatUnits(winState.escrow, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>}
          {winning && auction.lotKind === LotKind.Erc20 && <div className="fact"><dt>Lot</dt>
            <dd>{formatUnits(auction.lotAmount, auction.lotDecimals)} {auction.lotSymbol}</dd></div>}
          {auction.poolFee !== null && <div className="fact"><dt>Pool fee</dt>
            <dd>{formatUnits(auction.poolFee, STRK_DECIMALS)} STRK</dd></div>}
        </dl>
      )}
      <div className="stack" style={{ gap: ".8rem", marginTop: ".8rem" }}>
        {bids.map((b) => {
          const st = state[b.index];
          const wins = auction.status === Status.Finalized && b.index === auction.winnerIndex;
          if (st === undefined) return <p key={b.index} className="note">Bid #{b.index} · reading the chain…</p>;
          if (st && st.claimed) return <p key={b.index} className="note">Bid #{b.index} · already collected.</p>;
          if (st && unredeemable(st, auction.status, b.level, auction.clearingLevel)) {
            return <p key={b.index} className="note">Bid #{b.index} · forfeited above the clearing price — this escrow cannot be redeemed.</p>;
          }
          const redeem = st !== null && collectMode(st, auction.status) === "redeem";
          const amount = st ? formatUnits(st.escrow, auction.paymentDecimals) : null;
          return (
            <div key={b.index} className="stack" style={{ gap: ".5rem" }}>
              {wins ? (
                <>
                  <b>{auction.lotKind === LotKind.OffChain ? "You won — collect and name the buyer" : "You won — collect"}</b>
                  {auction.lotKind === LotKind.Erc721 && (
                    <label>Send the NFT to
                      <input className="mono" value={lotTo} onChange={(e) => setLotTo(e.target.value)} />
                      <span className="note">An account address. It will be public — the pool can’t hold NFTs. A fresh address keeps it apart from your wallet.</span>
                    </label>
                  )}
                  {auction.lotKind === LotKind.OffChain && (
                    <label>Buyer address
                      <input className="mono" value={lotTo} onChange={(e) => setLotTo(e.target.value)} />
                      <span className="note">Only this address can confirm or reject delivery. It will be public, and the seller will use it to know who won.</span>
                    </label>
                  )}
                  <p className="note" style={{ margin: 0 }}>
                    {auction.lotKind === LotKind.Erc20 && <>The lot and your surplus{amount ? ` (${amount} ${auction.paymentSymbol})` : ""} come out together, in one transaction.</>}
                    {auction.lotKind === LotKind.Erc721 && <>Your surplus{amount ? ` (${amount} ${auction.paymentSymbol})` : ""} comes in the same transaction.</>}
                    {auction.lotKind === LotKind.OffChain && <>Your surplus{amount ? ` (${amount} ${auction.paymentSymbol})` : ""} comes back now. Your payment stays in the contract until you confirm or reject delivery.</>}
                  </p>
                </>
              ) : (
                <span className="note">Bid #{b.index}{amount ? ` · ${amount} ${auction.paymentSymbol}` : ""}</span>
              )}
              <div className="row">
                <button className="primary" disabled={busy || (rail === "private" && !privateOk)}
                        onClick={() => void run(b, st ?? null)}>
                  {busy ? "Working…"
                    : wins && auction.lotKind === LotKind.Erc20 ? (rail === "private" ? "Collect both privately — one transaction" : "Collect the lot and your surplus")
                      : wins && auction.lotKind === LotKind.Erc721 ? "Collect the NFT and your surplus"
                        : wins ? "Collect and name this buyer"
                          : redeem ? "Redeem forfeit" : "Collect"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {Object.values(state).some((s) => s?.disposition === Disposition.Forfeit) && (
        <p className="note" style={{ marginTop: ".8rem" }}>
          A bid marked <b>forfeited</b> is one the auctioneer settled without a reveal from you.
          If it was at or below the clearing price, redeeming serves the loser-side proof yourself
          and returns the escrow in full. If it was above, there is no proof to serve, and the
          escrow stays in the contract.
        </p>
      )}
      {msg && <p className="ok mono" style={{ wordBreak: "break-all" }}>{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── off-chain delivery ──────────────────────────────────────────────── */

/**
 * The off-chain lot's delivery escrow, after the auction is final. The buyer confirms
 * (pays the seller) or rejects (destroys the payment and the seller's bond); silence
 * until the deadline pays the seller, and anyone may release it then.
 */
export function DeliveryPanel({
  auction, connection, now, mine, onDone,
}: { auction: AuctionView; connection: Connection | null; now: number; mine: StoredBid[]; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = auction.delivery;
  if (auction.lotKind !== LotKind.OffChain || !d || auction.status !== Status.Finalized) return null;

  const isBuyer = !!connection && BigInt(d.buyer) !== 0n && sameAddress(connection.address, d.buyer);
  const isWinner = mine.some((b) => b.index === auction.winnerIndex);
  const passed = now >= d.deadline;
  const price = `${formatUnits(d.price, auction.paymentDecimals)} ${auction.paymentSymbol}`;
  const bond = `${formatUnits(auction.sellerBond, auction.paymentDecimals)} ${auction.paymentSymbol}`;

  async function act(entrypoint: "confirm_delivery" | "reject_delivery" | "release_proceeds", done: string) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setMsg(null); setBusy(true);
    try {
      /* Confirm and reject check their caller is the buyer, and a read has no caller, so
         only the permissionless release is tried as a read first. */
      setMsg(said(await sendAndWait(connection, [simpleCall(auction.contract, entrypoint, auction.terms.auctionId)],
        { preflight: entrypoint === "release_proceeds" }), done));
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); setRejecting(false); }
  }

  if (d.outcome === DeliveryOutcome.Confirmed) {
    return <div className="panel okbox"><b>Delivery confirmed.</b> The seller can now take the {price} payment and their bond.</div>;
  }
  if (d.outcome === DeliveryOutcome.Rejected) {
    return <div className="panel warnbox"><b>Delivery rejected.</b> {price} and the seller’s {bond} bond are locked in the contract for good.</div>;
  }
  if (d.outcome === DeliveryOutcome.Released) {
    return <div className="panel"><b>The deadline passed without a rejection.</b> The seller was paid.</div>;
  }
  if (!isBuyer && !isWinner && !passed) return null;

  return (
    <div className="panel">
      <p className="eyebrow">Delivery deadline</p>
      <p style={{ fontSize: "1.35rem", fontWeight: 600, margin: ".2rem 0" }}>{utcDate(d.deadline)}</p>
      {!passed && <p className="countdown">{countdown(d.deadline, now)} left</p>}
      {BigInt(d.buyer) === 0n ? (
        <p>The winner hasn’t collected yet, so no buyer address is named. If nobody rejects before the deadline, the seller is paid.</p>
      ) : passed ? (
        <>
          <p>The deadline has passed without a rejection, so the seller is owed the payment and their bond. Anyone can release it.</p>
          <button className="primary" disabled={busy} onClick={() => void act("release_proceeds", "Released to the seller.")}>Release to the seller</button>
        </>
      ) : (
        <>
          <p>The seller delivers now. Your payment, <b className="mono">{price}</b>, stays in the contract until you decide. If you do nothing, the seller is paid when the deadline passes.</p>
          {!isBuyer && <p className="note">Only the buyer address {shortAddr(d.buyer)} can confirm or reject. Connect it to act.</p>}
          {isBuyer && !rejecting && (
            <div className="stack" style={{ gap: ".6rem", marginTop: ".6rem" }}>
              <button className="primary" disabled={busy} onClick={() => void act("confirm_delivery", "Delivery confirmed.")}>Confirm — pay the seller</button>
              <button className="danger" disabled={busy} onClick={() => setRejecting(true)}>Reject — destroy the payment and the seller’s bond</button>
            </div>
          )}
          {isBuyer && rejecting && (
            <div className="panel warnbox" role="dialog" aria-label="Reject delivery" style={{ marginTop: ".8rem" }}>
              <h3 style={{ fontSize: "var(--step-1)" }}>Reject delivery?</h3>
              <p>Your <b className="mono">{price}</b> payment and the seller’s <b className="mono">{bond}</b> bond will be locked in the contract permanently. <b>Nobody receives them</b> — not you, not the seller. This can’t be undone.</p>
              <p className="note">If the item arrived, confirm instead. Rejecting doesn’t get your payment back.</p>
              <label>Type REJECT to continue
                <input className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ maxWidth: "14rem" }} />
              </label>
              <div className="row" style={{ marginTop: ".6rem" }}>
                <button onClick={() => { setRejecting(false); setTyped(""); }}>Keep waiting</button>
                <button className="danger" disabled={typed !== "REJECT" || busy}
                        onClick={() => void act("reject_delivery", "Delivery rejected.")}>Reject and destroy both</button>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <p className="ok mono" style={{ wordBreak: "break-all" }}>{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── the seller's side ───────────────────────────────────────────────── */

/**
 * The seller is paid by pull, so no token that refuses them can hold up anyone else.
 * Anyone may trigger either payout; both only ever pay the seller.
 */
export function SellerPanel({
  auction, connection, onDone,
}: { auction: AuctionView; connection: Connection | null; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Once paid, the auction re-reads with nothing owed; the receipt line stays. */
  if (auction.version !== 2 || (auction.sellerOwed === 0n && !auction.lotReclaimable && !msg)) return null;
  const isSeller = !!connection && sameAddress(connection.address, auction.seller);

  async function act(entrypoint: "withdraw_seller" | "reclaim_lot", done: string) {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setMsg(null); setBusy(true);
    try {
      setMsg(said(await sendAndWait(connection, [simpleCall(auction.contract, entrypoint, auction.terms.auctionId)],
        { preflight: true }), done));
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <p className="eyebrow">{isSeller ? "Yours to collect" : "Owed to the seller"}</p>
      <div className="stack" style={{ gap: ".6rem", marginTop: ".5rem" }}>
        {auction.sellerOwed > 0n && (
          <div className="row">
            <span className="mono">{formatUnits(auction.sellerOwed, auction.paymentDecimals)} {auction.paymentSymbol}</span>
            <button className="primary" disabled={busy || !connection}
                    onClick={() => void act("withdraw_seller", "Paid to the seller.")}>
              {isSeller ? "Withdraw" : "Pay the seller"}
            </button>
          </div>
        )}
        {auction.lotReclaimable && (
          <div className="row">
            <span>The unsold lot</span>
            <button className="primary" disabled={busy || !connection}
                    onClick={() => void act("reclaim_lot", "The lot is back with the seller.")}>
              {isSeller ? "Take the lot back" : "Return the lot to the seller"}
            </button>
          </div>
        )}
      </div>
      {msg && <p className="ok mono" style={{ wordBreak: "break-all" }}>{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ── abandon ─────────────────────────────────────────────────────────── */

/**
 * Cancels a sealed auction whose auctioneer never settled it. Permissionless, and shown
 * to anyone, because it has to work when the auctioneer has gone.
 */
export function AbandonPanel({
  auction, connection, now, onDone,
}: { auction: AuctionView; connection: Connection | null; now: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (auction.status !== Status.Sealed) return null;
  const graceEnds = abandonAt(auction);
  if (!graceEnds || now < graceEnds) return null;

  async function abandon() {
    if (!connection) return setErr("Connect a wallet first.");
    setErr(null); setBusy(true);
    try {
      setMsg(said(await sendAndWait(connection, [simpleCall(auction.contract, "abandon", auction.terms.auctionId)]), "Cancelled."));
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="panel accent">
      <p className="eyebrow">Never settled</p>
      <p style={{ marginTop: ".5rem" }}>
        The auctioneer’s time to settle ran out — it ended {utcDate(graceEnds)}.
      </p>
      <p className="note" style={{ marginTop: ".5rem" }}>
        <b>Anyone can cancel it now.</b> Every bidder gets their escrow back and an equal share
        of the auctioneer’s forfeited bond; the lot goes back to the seller.
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
