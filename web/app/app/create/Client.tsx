"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CallData, RpcProvider, num, shortString } from "starknet";
import { AuctionKind, Status } from "@vickrey/client";
import { config, utcDate } from "@/lib/config";
import { nameOf, symbolOf } from "@/lib/chain";
import {
  addPay, lotDecimals as asLotDecimals, payDecimals as asPayDecimals, showLot, showPay,
  toLotUnits, toPayUnits, type LotDecimals, type PayDecimals,
} from "@/lib/amounts";
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
 * The payment token is chosen from a list, never typed.
 *
 * Its decimals govern every price on the screen — reserve, tick, cap, escrow, bond — so
 * an address that answers `decimals()` with something unexpected mis-scales all of them
 * at once. The lot token is free entry because the lot is whatever you are selling and
 * we cannot know it; the thing prices are denominated in is a much shorter list, and
 * curating it removes the failure mode entirely rather than validating around it.
 */
const PAYMENT_TOKENS = [
  { symbol: "STRK", address: config.strkAddress, note: "The fee token. 18 decimals." },
  {
    symbol: "USDC",
    address: config.network === "mainnet"
      ? "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
      : "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
    note: "Six decimals, not eighteen — the case that breaks a hardcoded scale.",
  },
  /* Sepolia only: a six-decimal token we deployed so the two-token path could be
     rehearsed against a lot token with eight. Neither is 18, so a crossed scale shows up
     as a figure that is wrong by a factor of a hundred rather than as a coincidence. */
  ...(config.network === "sepolia"
    ? [{
        symbol: "TUSD",
        address: "0x068feffcc2b4264ea13f8e7f29ee198bbbccd2632bd094df1983e1faeb2d3663",
        note: "Rehearsal token, six decimals.",
      }] as const
    : []),
] as const;

/** What a token says about itself. Both are read the same way; only entry differs. */
interface TokenInfo { decimals: number; symbol: string; name: string }

async function readToken(address: string): Promise<TokenInfo> {
  const p = new RpcProvider({ nodeUrl: config.rpcUrl });
  const call = (entrypoint: string) =>
    p.callContract({ contractAddress: address, entrypoint, calldata: [] });

  const dr = await call("decimals");
  const dec = Number(BigInt(dr[0]!));
  if (!Number.isFinite(dec) || dec < 0 || dec > 32) throw new Error("decimals out of range");

  /*
    Symbols are decoded by `symbolOf` in lib/chain.ts rather than here, because this file
    had its own copy and the copy was wrong. A ByteArray return is
    `[num_full_words, …words, pending_word, pending_len]`, so a three-felt symbol has the
    text at index 1 — and reading `r[length - 3]` lands on `num_full_words`, which is
    `0x0`, which decodes to the string "0", which passes a printable-character test.

    STRK has been rendering in this form as symbol "0" the whole time. Nothing failed;
    the wrong answer was simply printable. One decoder now, and it is the one that was
    already right.
  */
  const [symbol, name] = await Promise.all([
    symbolOf(p, address),
    nameOf(p, address),
  ]);

  return { decimals: dec, symbol, name };
}

export default function Client() {
  const { connection, ensureChain } = useWallet();
  const d = useDashData();
  const [step, setStep] = useState(0);

  /* Free entry: the lot is whatever you are selling. Validated on input, and the form
     refuses to proceed until the address answers. */
  const [lotToken, setLotToken] = useState("");
  /* Chosen, never typed — see PAYMENT_TOKENS. */
  const [payToken, setPayToken] = useState<string>(PAYMENT_TOKENS[0].address);
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
  /* Branded, so the compiler refuses a crossing. There is deliberately no variable
     called `decimals` anywhere in this file. */
  const [lotInfo, setLotInfo] = useState<TokenInfo | null>(null);
  const [payInfo, setPayInfo] = useState<TokenInfo | null>(null);
  const [lotErr, setLotErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{10,}$/.test(lotToken)) { setLotInfo(null); setLotErr(null); return; }
    let live = true;
    setReading(true);
    readToken(lotToken)
      .then((info) => { if (live) { setLotInfo(info); setLotErr(null); } })
      .catch(() => {
        if (!live) return;
        setLotInfo(null);
        setLotErr("This address did not answer as an ERC-20. Check it — the form will "
          + "not create an auction against a token it cannot read.");
      })
      .finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [lotToken]);

  /* Curated, so this cannot fail on a typo — but still read rather than assumed, because
     a hardcoded 18 for USDC is the exact bug this file exists to avoid. */
  useEffect(() => {
    let live = true;
    readToken(payToken)
      .then((info) => { if (live) setPayInfo(info); })
      .catch(() => { if (live) setPayInfo(null); });
    return () => { live = false; };
  }, [payToken]);

  const payD: PayDecimals | null = payInfo ? asPayDecimals(payInfo.decimals) : null;
  const lotD: LotDecimals | null = lotInfo ? asLotDecimals(lotInfo.decimals) : null;
  const paySym = payInfo?.symbol || "—";
  const lotSym = lotInfo?.symbol || "—";

  /**
   * The ladder, entirely in payment units. Reserve, top, tick and cap are prices, and a
   * price is denominated in what you pay with — never in the lot.
   */
  const derived = useMemo(() => {
    if (!payD) return { error: "Reading the payment token…" };
    try {
      const r = toPayUnits(reserve, payD), t = toPayUnits(top, payD);
      if (levels < 2) return { error: "A ladder needs at least two levels." };
      if (t <= r) return { error: "The top of the ladder must be above the reserve." };
      const tick = (t - r) / BigInt(levels - 1);
      if (tick === 0n) return { error: "Too many levels for that range — the rungs collapse." };
      /* Integer division, so the top you type is often not on the ladder. The contract
         stores reserve, tick and level count — never a "top" — and derives the cap as
         reserve + (levels-1)*tick. Silently accepting a top nobody can bid would let an
         auctioneer believe they had listed a range they had not. */
      const cap = addPay(r, (tick * BigInt(levels - 1)) as typeof r);
      return {
        reserve: r, tick: tick as typeof r, cap,
        shortfall: (t - cap) as typeof r, error: null as string | null,
      };
    } catch { return { error: "Reserve and top must be numbers." }; }
  }, [reserve, top, levels, payD]);

  const ready = !!payD && !!lotD && !derived.error && !!derived.reserve && !lotErr;

  const submit = async () => {
    if (!connection || !ready || !payD || !lotD) return;
    // Blocks on a chain mismatch rather than letting the wallet throw after approval.
    if (!(await ensureChain())) return;
    setBusy(true); setErr(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + closeIn;
      const lot = toLotUnits(lotAmount, lotD);
      const bondUnits = toPayUnits(bond, payD);

      const calldata = CallData.compile([
        connection.address, connection.address,
        /* payment_token, then lot_token. They were the same address until now, which is
           why the order never mattered and why getting it wrong would have been
           invisible. */
        payToken, lotToken,
        num.toHex(lot),
        num.toHex(kind === AuctionKind.Vickrey ? 1 : 0),
        num.toHex(derived.reserve!), num.toHex(derived.tick!),
        num.toHex(levels), num.toHex(deadline), num.toHex(window_),
        num.toHex(bondUnits), shortString.encodeShortString(title.slice(0, 31)),
      ]);

      /*
        Two approvals, because `create_auction` makes two pulls from two different
        tokens: the lot from `lot_token` and the bond from `payment_token`. With one
        token these collapsed into a single approval for the sum, which is why this is a
        three-call multicall that has never run anywhere before.

        Approving exactly what will be pulled, not the sum and not an unbounded
        allowance: an approval left over is an approval somebody else can use.
      */
      const calls = [
        { contractAddress: lotToken, entrypoint: "approve",
          calldata: CallData.compile([config.auctionAddress, num.toHex(lot), "0x0"]) },
        ...(bondUnits > 0n
          ? [{ contractAddress: payToken, entrypoint: "approve",
               calldata: CallData.compile([config.auctionAddress, num.toHex(bondUnits), "0x0"]) }]
          : []),
        { contractAddress: config.auctionAddress, entrypoint: "create_auction", calldata },
      ];

      const { transaction_hash } = await connection.account.execute(calls);
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
      <DashShell title="Create auction" actions={d.actions} ownsAuctions={d.ownsAuctions}>
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
    <DashShell title="Create auction" actions={d.actions} ownsAuctions={d.ownsAuctions}>
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
                "The ERC-20 being auctioned. It must transfer exactly what it is told: "
                + "fee-on-transfer and rebasing tokens break the accounting, and the "
                + "contract does not check.")}

              {/* Read back, so the address is confirmed by the token rather than by the
                  person typing it. Nothing proceeds until this answers. */}
              {lotErr && <p className="err" style={{ marginTop: "-.6rem" }}>{lotErr}</p>}
              {reading && !lotErr && <p className="note" style={{ marginTop: "-.6rem" }}>Reading the token…</p>}
              {lotInfo && (
                <div className="panel" style={{ marginTop: "-.4rem", marginBottom: "1rem" }}>
                  <p className="note" style={{ margin: 0 }}>
                    <b>{lotInfo.name || "(no name)"}</b> · <b>{lotInfo.symbol || "(no symbol)"}</b>
                    {" · "}{lotInfo.decimals} decimals
                  </p>
                </div>
              )}

              {field("Payment token", (
                <select value={payToken} onChange={(e) => setPayToken(e.target.value)}>
                  {PAYMENT_TOKENS.map((t) => (
                    <option key={t.address} value={t.address}>
                      {t.symbol} — {t.note}
                    </option>
                  ))}
                </select>
              ), payInfo
                ? `Every price on this screen is in ${payInfo.symbol}, at ${payInfo.decimals} decimals. `
                  + "Chosen from a list rather than typed: its decimals scale the reserve, the "
                  + "tick, the cap and the bond all at once."
                : "Reading…")}

              {field("Lot amount", <input value={lotAmount}
                onChange={(e) => setLotAmount(e.target.value)} />,
                lotD && lotInfo
                  ? `Transferred to the contract on create — ${showLot(toLotUnits(lotAmount || "0", lotD), lotD, lotInfo.symbol || "units")}.`
                  : "Transferred to the contract on create.")}
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
                    Spacing <b>{showPay(derived.tick!, payD!, paySym)}</b> per rung
                  </p>
                  <p className="note">
                    Highest bid anyone can place:{" "}
                    <b>{showPay(derived.cap!, payD!, paySym)}</b>
                  </p>
                  {derived.shortfall! > 0n && (
                    <div className="panel" style={{ borderColor: "var(--accent-edge)",
                                                    background: "var(--accent-dim)", marginTop: ".6rem" }}>
                      <p style={{ margin: 0 }}>
                        <b>{top} is not on this ladder.</b> Rungs are evenly spaced, and{" "}
                        {levels} of them cannot divide this range exactly — the spacing is
                        rounded down, so the top rung lands{" "}
                        <b>{showPay(derived.shortfall!, payD!, paySym)}</b> short at{" "}
                        <b>{showPay(derived.cap!, payD!, paySym)}</b>.
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
                    ? showPay(derived.cap, payD!, paySym) : "…"} — regardless of what they bid.
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
                <div className="fact"><dt>Lot</dt>
                  <dd>{lotD && lotInfo
                    ? showLot(toLotUnits(lotAmount || "0", lotD), lotD, lotInfo.symbol || "units")
                    : "—"}
                    <span className="note" style={{ display: "block" }}>
                      {lotInfo?.name || lotToken.slice(0, 14) + "…"}
                    </span></dd></div>
                <div className="fact"><dt>Priced in</dt>
                  <dd>{paySym}
                    <span className="note" style={{ display: "block" }}>
                      {payInfo ? `${payInfo.decimals} decimals` : "—"}
                    </span></dd></div>
                <div className="fact"><dt>Reserve</dt>
                  <dd>{payD ? showPay(toPayUnits(reserve || "0", payD), payD, paySym) : "—"}</dd></div>
                <div className="fact"><dt>Top requested</dt>
                  <dd>{payD ? showPay(toPayUnits(top || "0", payD), payD, paySym) : "—"}</dd></div>
                <div className="fact"><dt>Highest bid possible</dt>
                  <dd>{derived.cap ? showPay(derived.cap, payD!, paySym) : "—"}
                    {derived.shortfall! > 0n && (
                      <span className="note" style={{ display: "block" }}>
                        {showPay(derived.shortfall!, payD!, paySym)} below the top you asked for
                      </span>
                    )}</dd></div>
                <div className="fact"><dt>Levels</dt><dd>{levels}</dd></div>
                <div className="fact"><dt>Escrow, everyone</dt>
                  <dd>{derived.cap ? showPay(derived.cap, payD!, paySym) : "—"}</dd></div>
                <div className="fact"><dt>Your bond</dt>
                  <dd>{payD ? showPay(toPayUnits(bond || "0", payD), payD, paySym) : "—"}</dd></div>
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
                      onClick={() => void submit()} disabled={busy || !ready}>
                {busy ? "Waiting for your wallet…" : "Create auction"}
              </button>
            </>
          )}

          <div className="row" style={{ gap: ".6rem", marginTop: "1.4rem" }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
            {step < STEPS.length - 1 && (
              <button className="primary" onClick={() => setStep((s) => s + 1)}
                      disabled={(step === 0 && (!lotInfo || !!lotErr || reading))
                                || (step === 1 && !!derived.error)}>Next</button>
            )}
          </div>
        </div>

        {/* The ladder as it is being built. Three numbers become a shape. */}
        <div className="panel">
          <div className="spread">
            <p className="eyebrow" style={{ margin: 0 }}>Preview</p>
            <span className="note">step 2 · Ladder</span>
          </div>
          {derived.error ? (
            <p className="note" style={{ marginTop: ".6rem" }}>{derived.error}</p>
          ) : (
            <Ladder numLevels={levels} reservePrice={derived.reserve!} tick={derived.tick!}
                    symbol={paySym} decimals={payD ?? 18} bidCount={0} status={Status.Open} />
          )}
          {/* It is live, but only three inputs feed it — and they are all on one step.
              Without saying so it reads as frozen on the other four. */}
          <p className="note" style={{ marginTop: ".8rem" }}>
            {step === 1
              ? "Redraws as you change the reserve, the top or the level count."
              : "Shows the ladder from step 2. Nothing on this step changes it."}
          </p>
        </div>
      </div>
    </DashShell>
  );
}
