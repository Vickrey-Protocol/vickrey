"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CallData, RpcProvider, num, shortString } from "starknet";
import { AuctionKind, Status } from "@vickrey/client";
import { config, formatUnits, utcDate } from "@/lib/config";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { Ladder } from "@/components/Ladder";
import { useWallet } from "@/components/WalletProvider";

/**
 * Create an auction. One decision per step, with the ladder drawing as you configure it.
 *
 * The ladder is the part people get wrong: reserve, top and level count together decide
 * what a bidder can express, and a spacing that is too coarse silently makes the auction
 * useless. Showing the rungs as they are chosen turns three abstract numbers into the
 * thing they produce.
 */
const STEPS = ["Lot", "Ladder", "Escrow", "Timing", "Review"] as const;

const DISPUTE_PRESETS = [
  { label: "Demo", secs: 180, note: "Three minutes. Long enough to show, far too short to protect real value." },
  { label: "Supervised", secs: 3600, note: "An hour. Workable if someone is watching the auction." },
  { label: "Suggested", secs: 86400, note: "A day. The shortest window a bidder could reasonably be expected to catch." },
];

/**
 * Human amount to token units, at the token's **own** decimals.
 *
 * Hardcoding 18 works for STRK and ETH and is wrong for USDC, which has six — an
 * auction created that way would escrow a millionth of what the form displayed. The
 * decimals are read from the token below, not assumed here.
 */
const toUnits = (s: string | undefined, decimals: number): bigint => {
  if (!s) throw new Error("required");
  const [w = "", f = ""] = s.trim().split(".");
  if (!/^\d*$/.test(w) || !/^\d*$/.test(f)) throw new Error("not a number");
  return BigInt(w || "0") * 10n ** BigInt(decimals)
    + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
};

export default function Client() {
  const { connection } = useWallet();
  const d = useDashData();
  const [step, setStep] = useState(0);

  const [lotToken, setLotToken] = useState(config.strkAddress ?? "");
  const [lotAmount, setLotAmount] = useState("0.001");
  const [title, setTitle] = useState("ONE RARE THING");
  const [reserve, setReserve] = useState("0.001");
  const [top, setTop] = useState("0.008");
  const [levels, setLevels] = useState(8);
  const [bond, setBond] = useState("0.001");
  const [closeIn, setCloseIn] = useState(600);
  const [window_, setWindow] = useState(86400);
  const [kind, setKind] = useState<AuctionKind>(AuctionKind.Vickrey);
  /* Read from the token the moment it is entered. Everything the form computes —
     spacing, cap, escrow, the preview ladder — is denominated in these. */
  const [decimals, setDecimals] = useState(18);
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{10,}$/.test(lotToken)) { setTokenErr(null); return; }
    let live = true;
    (async () => {
      try {
        const p = new RpcProvider({ nodeUrl: config.rpcUrl });
        const r = await p.callContract({ contractAddress: lotToken, entrypoint: "decimals", calldata: [] });
        if (!live) return;
        const d = Number(BigInt(r[0]!));
        setDecimals(Number.isFinite(d) && d >= 0 && d <= 32 ? d : 18);
        setTokenErr(null);
      } catch {
        if (live) setTokenErr("Could not read this token's decimals. Check the address.");
      }
    })();
    return () => { live = false; };
  }, [lotToken]);

  const derived = useMemo(() => {
    try {
      const r = toUnits(reserve, decimals), t = toUnits(top, decimals);
      if (levels < 2) return { error: "A ladder needs at least two levels." };
      if (t <= r) return { error: "The top of the ladder must be above the reserve." };
      const tick = (t - r) / BigInt(levels - 1);
      if (tick === 0n) return { error: "Too many levels for that range — the rungs collapse." };
      /* Integer division, so the top you type is often not on the ladder. The contract
         stores reserve, tick and level count — never a "top" — and derives the cap as
         reserve + (levels-1)*tick. Silently accepting a top nobody can bid would let an
         auctioneer believe they had listed a range they had not. */
      const cap = r + tick * BigInt(levels - 1);
      return { reserve: r, tick, cap, shortfall: t - cap, error: null as string | null };
    } catch { return { error: "Reserve and top must be numbers." }; }
  }, [reserve, top, levels, decimals]);

  const submit = async () => {
    if (!connection || derived.error || !derived.reserve) return;
    setBusy(true); setErr(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + closeIn;
      const calldata = CallData.compile([
        connection.address, connection.address, lotToken, lotToken,
        num.toHex(toUnits(lotAmount, decimals)),
        num.toHex(kind === AuctionKind.Vickrey ? 1 : 0),
        num.toHex(derived.reserve), num.toHex(derived.tick!),
        num.toHex(levels), num.toHex(deadline), num.toHex(window_),
        num.toHex(toUnits(bond, decimals)), shortString.encodeShortString(title.slice(0, 31)),
      ]);
      const { transaction_hash } = await connection.account.execute([
        { contractAddress: lotToken, entrypoint: "approve",
          calldata: CallData.compile([config.auctionAddress,
            num.toHex(toUnits(lotAmount, decimals) + toUnits(bond, decimals)), "0x0"]) },
        { contractAddress: config.auctionAddress, entrypoint: "create_auction", calldata },
      ]);
      setDone(transaction_hash);
      d.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label style={{ display: "block", marginBottom: "1rem" }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: ".35rem" }}>{label}</span>
      {node}
      {hint && <span className="note" style={{ display: "block", marginTop: ".3rem" }}>{hint}</span>}
    </label>
  );

  if (done) {
    return (
      <DashShell title="Create auction" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
        <div className="panel accent">
          <p className="eyebrow">Submitted</p>
          <h2 className="display" style={{ fontSize: "var(--step-2)", marginTop: ".3rem" }}>
            Auction created
          </h2>
          <p className="note mono" style={{ marginTop: ".6rem", wordBreak: "break-all" }}>{done}</p>
          <div className="row" style={{ gap: ".6rem", marginTop: "1rem" }}>
            <Link className="primary" href="/app/manage">Go to your auctions</Link>
            <button onClick={() => { setDone(null); setStep(0); }}>Create another</button>
          </div>
        </div>
      </DashShell>
    );
  }

  return (
    <DashShell title="Create auction" actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      <div className="row" style={{ gap: ".4rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? "primary" : ""} onClick={() => setStep(i)}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="cols">
        <div className="panel">
          {step === 0 && (
            <>
              {field("Lot token", <input value={lotToken}
                onChange={(e) => setLotToken(e.target.value)} placeholder="0x…" />,
                tokenErr ?? `The ERC-20 being auctioned. Escrow and payment use the same token. Decimals read from the token: ${decimals}.`)}
              {field("Lot amount", <input value={lotAmount}
                onChange={(e) => setLotAmount(e.target.value)} />, "Transferred to the contract on create.")}
              {field("Title", <input value={title} maxLength={31}
                onChange={(e) => setTitle(e.target.value)} />, "Up to 31 characters — it is stored as a short string.")}
              {field("Kind", (
                <select value={kind}
                        onChange={(e) => setKind(Number(e.target.value) as AuctionKind)}>
                  <option value={AuctionKind.Vickrey}>Vickrey — winner pays the second price</option>
                  <option value={AuctionKind.FirstPrice}>First price — winner pays their own bid</option>
                </select>
              ))}
            </>
          )}

          {step === 1 && (
            <>
              {field("Reserve price", <input value={reserve}
                onChange={(e) => setReserve(e.target.value)} />, "The bottom rung. No bid can be below it.")}
              {field("Top of ladder", <input value={top}
                onChange={(e) => setTop(e.target.value)} />, "The highest expressible bid.")}
              {field("Levels", <input type="number" min={2} max={64} value={levels}
                onChange={(e) => setLevels(Number(e.target.value))} />,
                "More levels means finer bids and a longer proof.")}
              {derived.error ? (
                <p className="err">{derived.error}</p>
              ) : (
                <>
                  <p className="note">
                    Spacing <b>{formatUnits(derived.tick!, decimals, decimals)}</b> per rung
                  </p>
                  <p className="note">
                    Highest bid anyone can place:{" "}
                    <b>{formatUnits(derived.cap!, decimals, decimals)}</b>
                  </p>
                  {derived.shortfall! > 0n && (
                    <div className="panel" style={{ borderColor: "var(--accent-edge)",
                                                    background: "var(--accent-dim)", marginTop: ".6rem" }}>
                      <p style={{ margin: 0 }}>
                        <b>{top} is not on this ladder.</b> Rungs are evenly spaced, and{" "}
                        {levels} of them cannot divide this range exactly — the spacing is
                        rounded down, so the top rung lands{" "}
                        <b>{formatUnits(derived.shortfall!, decimals, decimals)}</b> short at{" "}
                        <b>{formatUnits(derived.cap!, decimals, decimals)}</b>.
                      </p>
                      <p className="note" style={{ marginTop: ".5rem" }}>
                        Nothing has been adjusted for you. Change the top, or the level
                        count, if you want a different highest bid — or list it as it is,
                        which is a normal ladder and only the number you typed is
                        unreachable.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {field("Auctioneer bond", <input value={bond}
                onChange={(e) => setBond(e.target.value)} />,
                "Yours, slashed to anyone who proves you excluded a bid above the clearing price.")}
              <div className="panel" style={{ background: "var(--hatch-bg)" }}>
                <p className="eyebrow">Why escrow is the same for everyone</p>
                <p className="note" style={{ marginTop: ".4rem" }}>
                  Every bidder escrows the top of the ladder — {derived.cap
                    ? formatUnits(derived.cap, decimals) : "…"} — regardless of what they bid.
                  The withdrawal from the pool is a public ERC-20 transfer, so an escrow
                  that matched the bid would publish the bid. A uniform cap reveals
                  nothing, and the difference is refunded.
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {field("Bidding closes in", (
                <select value={closeIn} onChange={(e) => setCloseIn(Number(e.target.value))}>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={3600}>1 hour</option>
                  <option value={86400}>24 hours</option>
                </select>
              ), `Closes ${utcDate(Math.floor(Date.now() / 1000) + closeIn)}`)}
              <span className="eyebrow" style={{ display: "block", marginBottom: ".35rem" }}>
                Dispute window
              </span>
              <div className="stack">
                {DISPUTE_PRESETS.map((p) => (
                  <button key={p.secs} className={window_ === p.secs ? "primary" : ""}
                          onClick={() => setWindow(p.secs)} style={{ textAlign: "start" }}>
                    <b>{p.label}</b> — {p.secs}s
                    <span className="note" style={{ display: "block" }}>{p.note}</span>
                  </button>
                ))}
              </div>
              <p className="note" style={{ marginTop: ".8rem" }}>
                Anything short enough to demo is too short to protect real value. The
                window is the only time a wrong settlement can be challenged.
              </p>
            </>
          )}

          {step === 4 && (
            <>
              <dl className="facts">
                <div className="fact"><dt>Lot</dt><dd>{lotAmount} · {title}</dd></div>
                <div className="fact"><dt>Kind</dt>
                  <dd>{kind === AuctionKind.Vickrey ? "Vickrey" : "First price"}</dd></div>
                <div className="fact"><dt>Reserve</dt><dd>{reserve}</dd></div>
                <div className="fact"><dt>Top requested</dt><dd>{top}</dd></div>
                <div className="fact"><dt>Highest bid possible</dt>
                  <dd>{derived.cap ? formatUnits(derived.cap, decimals, decimals) : "—"}
                    {derived.shortfall! > 0n && (
                      <span className="note" style={{ display: "block" }}>
                        {formatUnits(derived.shortfall!, decimals, decimals)} below the top you asked for
                      </span>
                    )}</dd></div>
                <div className="fact"><dt>Levels</dt><dd>{levels}</dd></div>
                <div className="fact"><dt>Escrow, everyone</dt>
                  <dd>{derived.cap ? formatUnits(derived.cap, decimals) : "—"}</dd></div>
                <div className="fact"><dt>Your bond</dt><dd>{bond}</dd></div>
                <div className="fact"><dt>Bidding closes</dt>
                  <dd>{utcDate(Math.floor(Date.now() / 1000) + closeIn)}</dd></div>
                <div className="fact"><dt>Dispute window</dt><dd>{window_}s</dd></div>
              </dl>
              <p className="note" style={{ marginTop: ".9rem" }}>
                Creating transfers the lot and your bond to the contract in one
                transaction, after an approval for both.
              </p>
              {err && <p className="err" style={{ marginTop: ".6rem" }}>{err}</p>}
              <button className="primary" style={{ marginTop: "1rem" }}
                      onClick={() => void submit()} disabled={busy || !!derived.error}>
                {busy ? "Waiting for your wallet…" : "Create auction"}
              </button>
            </>
          )}

          <div className="row" style={{ gap: ".6rem", marginTop: "1.4rem" }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
            {step < STEPS.length - 1 && (
              <button className="primary" onClick={() => setStep((s) => s + 1)}
                      disabled={step === 1 && !!derived.error}>Next</button>
            )}
          </div>
        </div>

        {/* The ladder as it is being built. Three numbers become a shape. */}
        <div className="panel">
          <p className="eyebrow">Preview</p>
          {derived.error ? (
            <p className="note" style={{ marginTop: ".6rem" }}>{derived.error}</p>
          ) : (
            <Ladder numLevels={levels} reservePrice={derived.reserve!} tick={derived.tick!}
                    symbol="" decimals={decimals} bidCount={0} status={Status.Open} />
          )}
        </div>
      </div>
    </DashShell>
  );
}
