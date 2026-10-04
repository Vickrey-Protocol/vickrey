"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RpcProvider, hash, shortString } from "starknet";
import { AuctionKind, Status } from "@vickrey/client";
import { config, explorerContract, utcDate } from "@/lib/config";
import { nameOf, ownerOf, provider, symbolOf } from "@/lib/chain";
import {
  addPay, lotDecimals as asLotDecimals, payDecimals as asPayDecimals, showLot, showPay,
  toLotUnits, toPayUnits, type LotDecimals, type PayDecimals,
} from "@/lib/amounts";
import { LotKind, createCalls, termsHash } from "@/lib/v2";
import { missingFields, termsText, type TermsFields } from "@/lib/terms";
import {
  keepRevealKey, makeRevealKey, publicKeyOf, revealKeyFile, type StoredRevealKey,
} from "@/lib/revealKeys";
import { receiptOutcome, shortRevert } from "@/lib/receipt";
import { sameAddress } from "@/lib/wallet";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { Ladder } from "@/components/Ladder";
import { NftImage } from "@/components/NftImage";
import { useWallet } from "@/components/WalletProvider";

/**
 * Create an auction. One decision per step, with the ladder drawing as you configure it.
 *
 * Step 1 decides what is being sold — tokens, an NFT, or something off-chain — because
 * that decides what the contract holds, how the winner receives it, and how much bidders
 * must trust the seller. Step 4 makes the auction's reveal key: bidders reveal to it on
 * chain, and without it the auctioneer cannot settle.
 */
const STEPS = ["Lot", "Ladder", "Escrow", "Windows & keys", "Review"] as const;

const DISPUTE_PRESETS = [
  { label: "Demo", secs: 180, note: "Three minutes. Long enough to show, far too short to protect real value." },
  { label: "Supervised", secs: 3600, note: "An hour. Workable if someone is watching the auction." },
  { label: "Suggested", secs: 86400, note: "A day. The shortest window a bidder could reasonably be expected to catch." },
];
const REVEAL_PRESETS = [
  { label: "Demo", secs: 180, note: "Three minutes. Bidders must be watching." },
  { label: "Supervised", secs: 3600, note: "An hour." },
  { label: "Suggested", secs: 86400, note: "A day. Bidders who are away still get their bid revealed." },
];
const DELIVERY_PRESETS = [
  { label: "Demo", secs: 600, note: "Ten minutes, for a rehearsal only." },
  { label: "One week", secs: 7 * 86400, note: "" },
  { label: "Two weeks", secs: 14 * 86400, note: "" },
];

const PAYMENT_TOKENS = [
  { symbol: "STRK", address: config.strkAddress, note: "The fee token. 18 decimals." },
  {
    symbol: "USDC",
    address: config.network === "mainnet"
      ? "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
      : "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
    note: "Six decimals, not eighteen — the case that breaks a hardcoded scale.",
  },
] as const;

interface TokenInfo { decimals: number; symbol: string; name: string }

async function readToken(address: string): Promise<TokenInfo> {
  const p = new RpcProvider({ nodeUrl: config.rpcUrl });
  const dr = await p.callContract({ contractAddress: address, entrypoint: "decimals", calldata: [] });
  const dec = Number(BigInt(dr[0]!));
  if (!Number.isFinite(dec) || dec < 0 || dec > 32) throw new Error("decimals out of range");
  const [symbol, name] = await Promise.all([symbolOf(p, address), nameOf(p, address)]);
  return { decimals: dec, symbol, name };
}

type NftCheck =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "yours"; name: string }
  | { kind: "not-yours"; owner: string }
  | { kind: "not-721"; why: string };

const blankTerms: TermsFields = { what: "", condition: "", how: "", within: "", counts: "", reach: "" };

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

/** A window as a person reads it: "3 minutes", "1 hour", "7 days". */
function span(secs: number): string {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (secs % 86400 === 0) return unit(secs / 86400, "day");
  if (secs % 3600 === 0) return unit(secs / 3600, "hour");
  if (secs % 60 === 0) return unit(secs / 60, "minute");
  return unit(secs, "second");
}

export default function Client() {
  const { connection, ensureChain } = useWallet();
  const d = useDashData();
  const [step, setStep] = useState(0);

  const [lotKind, setLotKind] = useState<LotKind>(LotKind.Erc20);
  const [lotToken, setLotToken] = useState("");
  const [lotAmount, setLotAmount] = useState("0.001");
  const [collection, setCollection] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [nft, setNft] = useState<NftCheck>({ kind: "idle" });
  const [fields, setFields] = useState<TermsFields>(blankTerms);
  const [sellerBond, setSellerBond] = useState("0.001");
  const [delivery, setDelivery] = useState(7 * 86400);
  const [payToken, setPayToken] = useState<string>(PAYMENT_TOKENS[0].address);
  const [title, setTitle] = useState("ONE RARE THING");
  const [reserve, setReserve] = useState("0.001");
  const [top, setTop] = useState("0.008");
  const [levels, setLevels] = useState(8);
  const [bond, setBond] = useState("0.001");
  const [closeIn, setCloseIn] = useState(600);
  const [revealWin, setRevealWin] = useState(3600);
  const [window_, setWindow] = useState(86400);
  const [kind, setKind] = useState<AuctionKind>(AuctionKind.Vickrey);
  const [key, setKey] = useState<StoredRevealKey | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [lotInfo, setLotInfo] = useState<TokenInfo | null>(null);
  const [payInfo, setPayInfo] = useState<TokenInfo | null>(null);
  const [lotErr, setLotErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; id: string | null } | null>(null);

  useEffect(() => {
    if (lotKind !== LotKind.Erc20 || !/^0x[0-9a-fA-F]{10,}$/.test(lotToken)) {
      setLotInfo(null); setLotErr(null); return;
    }
    let live = true;
    setReading(true);
    readToken(lotToken)
      .then((info) => { if (live) { setLotInfo(info); setLotErr(null); } })
      .catch(() => {
        if (!live) return;
        setLotInfo(null);
        setLotErr("This address did not answer as an ERC-20. The form will not list a token it cannot read.");
      })
      .finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [lotToken, lotKind]);

  /* The collection is asked, not trusted: who owns this token, and does it answer as an
     ERC-721 at all. One that does not is refused here, before anything is signed. */
  useEffect(() => {
    if (lotKind !== LotKind.Erc721 || !/^0x[0-9a-fA-F]{10,}$/.test(collection) || !/^\d+$/.test(tokenId)) {
      setNft({ kind: "idle" }); return;
    }
    let live = true;
    setNft({ kind: "reading" });
    (async () => {
      try {
        const owner = await ownerOf(collection, BigInt(tokenId));
        const name = await nameOf(provider(), collection, "");
        if (!live) return;
        setNft(connection && sameAddress(owner, connection.address)
          ? { kind: "yours", name } : { kind: "not-yours", owner });
      } catch (e) {
        if (live) setNft({ kind: "not-721", why: e instanceof Error ? e.message.slice(0, 120) : String(e) });
      }
    })();
    return () => { live = false; };
  }, [collection, tokenId, lotKind, connection]);

  useEffect(() => {
    let live = true;
    readToken(payToken).then((i) => { if (live) setPayInfo(i); }).catch(() => { if (live) setPayInfo(null); });
    return () => { live = false; };
  }, [payToken]);

  /* A fresh key the first time step 4 is reached; kept in this browser at once, and the
     form waits until the auctioneer says they have the file too. */
  useEffect(() => {
    if (step === 3 && !key && config.auctionAddress) {
      const k = makeRevealKey(config.auctionAddress);
      keepRevealKey(k);
      setKey(k);
    }
  }, [step, key]);

  const payD: PayDecimals | null = payInfo ? asPayDecimals(payInfo.decimals) : null;
  const lotD: LotDecimals | null = lotInfo ? asLotDecimals(lotInfo.decimals) : null;
  const paySym = payInfo?.symbol || "—";

  const derived = useMemo(() => {
    if (!payD) return { error: "Reading the payment token…" };
    try {
      const r = toPayUnits(reserve, payD), t = toPayUnits(top, payD);
      if (levels < 2) return { error: "A ladder needs at least two levels." };
      if (t <= r) return { error: "The top of the ladder must be above the reserve." };
      const tick = (t - r) / BigInt(levels - 1);
      if (tick === 0n) return { error: "Too many levels for that range — the rungs collapse." };
      const cap = addPay(r, (tick * BigInt(levels - 1)) as typeof r);
      return { reserve: r, tick: tick as typeof r, cap, shortfall: (t - cap) as typeof r, error: null as string | null };
    } catch { return { error: "Reserve and top must be numbers." }; }
  }, [reserve, top, levels, payD]);

  const terms = lotKind === LotKind.OffChain ? termsText(fields) : "";
  const missing = lotKind === LotKind.OffChain ? missingFields(fields) : [];
  const lotOk = lotKind === LotKind.Erc20 ? !!lotInfo && !lotErr && !reading
    : lotKind === LotKind.Erc721 ? nft.kind === "yours"
      : missing.length === 0;
  const sellerBondUnits = payD && lotKind === LotKind.OffChain ? toPayUnits(sellerBond || "0", payD) : 0n;
  const bondUnits = payD ? toPayUnits(bond || "0", payD) : 0n;
  const ready = !!payD && lotOk && !derived.error && !!derived.reserve && !!key && keySaved;

  const submit = async () => {
    if (!connection || !ready || !payD || !key) return;
    if (!(await ensureChain())) return;
    setBusy(true); setErr(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + closeIn;
      const calls = createCalls({
        auction: config.auctionAddress,
        seller: connection.address,
        auctioneer: connection.address,
        paymentToken: payToken,
        lotToken: lotKind === LotKind.Erc20 ? lotToken : lotKind === LotKind.Erc721 ? collection : "0x0",
        lotAmount: lotKind === LotKind.Erc20 ? toLotUnits(lotAmount, lotD!) : lotKind === LotKind.Erc721 ? 1n : 0n,
        kind,
        reservePrice: derived.reserve!, tick: derived.tick!, numLevels: levels,
        bidDeadline: deadline, disputeWindow: window_, auctioneerBond: bondUnits,
        termsHash: terms ? termsHash(terms) : BigInt(shortString.encodeShortString(title.slice(0, 31) || "LOT")),
        lotKind, lotTokenId: lotKind === LotKind.Erc721 ? BigInt(tokenId) : 0n,
        revealKey: publicKeyOf(key), revealWindow: revealWin,
        deliveryWindow: lotKind === LotKind.OffChain ? delivery : 0,
        sellerBond: sellerBondUnits, terms,
      });
      const { transaction_hash } = await connection.account.execute(calls);
      const rcpt = await provider().waitForTransaction(transaction_hash);
      const outcome = receiptOutcome(rcpt);
      if (outcome.kind === "reverted") throw new Error(`The listing reverted on chain (${shortRevert(outcome.reason)}).`);
      /* The new id is a key of AuctionCreated, from this receipt. */
      const sel = BigInt(hash.getSelectorFromName("AuctionCreated"));
      const ev = ((rcpt as { events?: Array<{ from_address: string; keys: string[] }> }).events ?? [])
        .find((e) => BigInt(e.from_address) === BigInt(config.auctionAddress) && BigInt(e.keys[0]!) === sel);
      setDone({ hash: transaction_hash, id: ev ? BigInt(ev.keys[1]!).toString() : null });
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
          <p className="eyebrow">Listed</p>
          <h2 className="display" style={{ fontSize: "var(--step-2)", marginTop: ".3rem" }}>
            {done.id ? `Auction #${done.id} is live` : "Auction created"}
          </h2>
          <p className="note mono" style={{ marginTop: ".6rem", wordBreak: "break-all" }}>{done.hash}</p>
          <p className="note" style={{ marginTop: ".6rem" }}>Keep the reveal key file you downloaded: you need it to settle.</p>
          <div className="row" style={{ gap: ".6rem", marginTop: "1rem" }}>
            {done.id && <Link className="primary" href={`/auction/${done.id}`}>Open the auction</Link>}
            <Link href="/app/manage">Your auctions</Link>
          </div>
        </div>
      </DashShell>
    );
  }

  const kindCard = (k: LotKind, name: string, text: string) => (
    <label className={lotKind === k ? "rail on" : "rail"} style={{ cursor: "pointer" }}>
      <span className="rail-name" style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
        <input type="radio" name="lotkind" checked={lotKind === k} onChange={() => setLotKind(k)}
               style={{ width: "auto", margin: 0 }} /> {name}
      </span>
      <span className="note">{text}</span>
    </label>
  );

  const tf = (k: keyof TermsFields, label: string, required: boolean, placeholder: string) =>
    field(`${label}${required ? " *" : ""}`, <input value={fields[k]} placeholder={placeholder}
      onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />);

  return (
    <DashShell title="Create auction" actions={d.actions} ownsAuctions={d.ownsAuctions}>
      <div className="row" style={{ gap: ".4rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? "primary" : ""} onClick={() => setStep(i)}>{i + 1}. {s}</button>
        ))}
      </div>

      <div className="cols">
        <div className="panel">
          {step === 0 && (
            <>
              <p className="eyebrow">What are you selling?</p>
              <div className="rails" role="radiogroup" aria-label="Lot kind" style={{ margin: ".5rem 0 1.2rem" }}>
                {kindCard(LotKind.Erc20, "Tokens", "An amount of an ERC-20 token. The contract holds it from listing, and the winner can collect it privately.")}
                {kindCard(LotKind.Erc721, "An NFT", "One ERC-721 token. The contract holds it from listing. It goes to a public address the winner names: the privacy pool can’t hold NFTs.")}
                {kindCard(LotKind.OffChain, "Something off-chain", "A service, a physical item, a slot. The contract holds nothing, so bidders are trusting you to deliver. The winner’s payment is held until they confirm.")}
              </div>

              {lotKind === LotKind.Erc20 && (
                <>
                  {field("Lot token", <input value={lotToken} onChange={(e) => setLotToken(e.target.value)} placeholder="0x…" />,
                    "The ERC-20 being auctioned. A token that delivers less than it is asked for is refused by the contract.")}
                  {lotErr && <p className="err" style={{ marginTop: "-.6rem" }}>{lotErr}</p>}
                  {reading && !lotErr && <p className="note" style={{ marginTop: "-.6rem" }}>Reading the token…</p>}
                  {lotInfo && <p className="note" style={{ marginTop: "-.4rem" }}><b>{lotInfo.name || "(no name)"}</b> · <b>{lotInfo.symbol || "(no symbol)"}</b> · {lotInfo.decimals} decimals</p>}
                  {field("Lot amount", <input value={lotAmount} onChange={(e) => setLotAmount(e.target.value)} />,
                    lotD && lotInfo ? `Held by the contract from listing — ${showLot(toLotUnits(lotAmount || "0", lotD), lotD, lotInfo.symbol || "units")}.` : undefined)}
                  {field("Title", <input value={title} maxLength={31} onChange={(e) => setTitle(e.target.value)} />, "Up to 31 characters.")}
                </>
              )}

              {lotKind === LotKind.Erc721 && (
                <>
                  {field("Collection address", <input className="mono" value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="0x…" />,
                    "The ERC-721 contract. Bidders will see its name and a link to it on the explorer.")}
                  {field("Token ID", <input className="mono" value={tokenId} onChange={(e) => setTokenId(e.target.value)} style={{ maxWidth: "14rem" }} />)}
                  <div className="panel" style={{ background: "var(--hatch-bg)", marginBottom: "1rem" }}>
                    <p className="eyebrow">Read from the collection</p>
                    {nft.kind === "idle" && <p className="note">Enter the collection and token ID.</p>}
                    {nft.kind === "reading" && <p className="note">Reading the collection…</p>}
                    {nft.kind === "yours" && <>
                      <p className="ok" style={{ margin: ".3rem 0" }}>You own token #{tokenId}{nft.name ? ` of ${nft.name}` : ""}.</p>
                      <p className="ok" style={{ margin: ".3rem 0" }}>It answers as an ERC-721 (<span className="mono">owner_of</span>), so it can be held and delivered.</p>
                      <p className="note">Listing asks your wallet to approve this one token, then lists — one transaction.</p>
                    </>}
                    {nft.kind === "not-yours" && <p className="err">This token belongs to {nft.owner.slice(0, 10)}…, not this wallet.</p>}
                    {nft.kind === "not-721" && <p className="err">This collection didn’t answer as an ERC-721, so it can’t be listed. ({nft.why})</p>}
                    <p className="note" style={{ marginTop: ".4rem" }}>A collection that doesn’t answer as an ERC-721 is refused here, before anything is signed.</p>
                  </div>
                  {nft.kind === "yours" && (
                    <div className="panel" style={{ marginBottom: "1rem" }}>
                      <p className="eyebrow">What bidders will see</p>
                      <div style={{ marginTop: ".6rem" }}>
                        <NftImage collection={collection.trim()} tokenId={BigInt(tokenId)} size={140} />
                      </div>
                      <div className="spread" style={{ marginTop: ".5rem" }}>
                        <b>{nft.name || "NFT"} #{tokenId}</b><span className="lot-chip">NFT</span>
                      </div>
                      <p className="note" style={{ margin: ".3rem 0" }}>
                        <a href={explorerContract(collection.trim())} target="_blank" rel="noreferrer">View the collection on the explorer</a>
                      </p>
                      <p className="note">Held by the contract until the auction ends. The winner names a public address to receive it.</p>
                    </div>
                  )}
                </>
              )}

              {lotKind === LotKind.OffChain && (
                <>
                  <div className="warnbox" style={{ marginBottom: "1rem" }}>
                    <b>You are asking bidders to trust you.</b> The contract holds nothing for this
                    lot. The winner’s payment is held until they confirm delivery. If they reject
                    it, you are not paid and your bond is destroyed — nobody receives either.
                  </div>
                  <p className="note">Published on chain with the listing, word for word. The contract stores its hash, so the text bidders read is the text you’re held to.</p>
                  {tf("what", "What it is", true, "Signed first edition of …")}
                  {tf("condition", "Condition", false, "Near mint")}
                  {tf("how", "How it’s delivered", true, "Tracked post, worldwide")}
                  {tf("within", "Delivered within", true, "7 days of the auction ending")}
                  {tf("counts", "What counts as delivered", true, "The tracking number shows it delivered to the address the winner gave")}
                  {tf("reach", "How to reach the seller", true, "@handle or email")}
                  {missing.length > 0 && <p className="note">Still needed: {missing.length} field{missing.length === 1 ? "" : "s"}.</p>}
                </>
              )}

              {field("Payment token", (
                <select value={payToken} onChange={(e) => setPayToken(e.target.value)}>
                  {PAYMENT_TOKENS.map((t) => <option key={t.address} value={t.address}>{t.symbol} — {t.note}</option>)}
                </select>
              ), payInfo ? `Every price on this screen is in ${payInfo.symbol}, at ${payInfo.decimals} decimals.` : "Reading…")}
              {field("Kind", (
                <select value={kind} onChange={(e) => setKind(Number(e.target.value) as AuctionKind)}>
                  <option value={AuctionKind.Vickrey}>Vickrey — winner pays the second price</option>
                  <option value={AuctionKind.FirstPrice}>First price — winner pays their own bid</option>
                </select>
              ))}
            </>
          )}

          {step === 1 && (
            <>
              {field("Reserve price", <input value={reserve} onChange={(e) => setReserve(e.target.value)} />, "The bottom rung. No bid can be below it.")}
              {field("Top of ladder", <input value={top} onChange={(e) => setTop(e.target.value)} />, "The highest expressible bid.")}
              {field("Levels", <input type="number" min={2} max={1024} value={levels} onChange={(e) => setLevels(Number(e.target.value))} />,
                "More levels means finer bids. Bids are capped so settlement always fits one transaction: levels × bids ≤ 32,768.")}
              {derived.error ? <p className="err">{derived.error}</p> : (
                <>
                  <p className="note">Spacing <b>{showPay(derived.tick!, payD!, paySym)}</b> per rung</p>
                  <p className="note">Highest bid anyone can place: <b>{showPay(derived.cap!, payD!, paySym)}</b></p>
                  {derived.shortfall! > 0n && (
                    <p className="note"><b>{top} is not on this ladder.</b> The top rung lands {showPay(derived.shortfall!, payD!, paySym)} short, at {showPay(derived.cap!, payD!, paySym)}.</p>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {field("Auctioneer bond", <input value={bond} onChange={(e) => setBond(e.target.value)} />,
                "At stake on your settlement. It goes to a bid you leave out of it, or to the bidders if you never settle.")}
              {lotKind === LotKind.OffChain && field("Seller bond", <input value={sellerBond} onChange={(e) => setSellerBond(e.target.value)} />,
                derived.cap && payD
                  ? `${Number((sellerBondUnits * 100n) / (derived.cap || 1n))}% of the collateral. Paid in at listing. You get it back when the buyer confirms or the window ends; it is destroyed with the price if they reject.`
                  : undefined)}
              <div className="panel" style={{ background: "var(--hatch-bg)" }}>
                <p className="eyebrow">Why escrow is the same for everyone</p>
                <p className="note" style={{ marginTop: ".4rem" }}>
                  Every bidder escrows the top of the ladder — {derived.cap ? showPay(derived.cap, payD!, paySym) : "…"} — regardless
                  of what they bid, so the escrow says nothing about the bid behind it.
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
              <span className="eyebrow" style={{ display: "block", marginBottom: ".35rem" }}>Reveal window</span>
              <div className="stack" style={{ marginBottom: ".4rem" }}>
                {REVEAL_PRESETS.map((p) => (
                  <button key={p.secs} className={revealWin === p.secs ? "primary" : ""} onClick={() => setRevealWin(p.secs)} style={{ textAlign: "start" }}>
                    <b>{p.label}</b><span className="note" style={{ display: "block" }}>{p.note}</span>
                  </button>
                ))}
              </div>
              <p className="note" style={{ marginBottom: "1rem" }}>Bidders post their encrypted reveals in this window. You settle once it ends. A bidder who misses it can’t be settled.</p>
              <span className="eyebrow" style={{ display: "block", marginBottom: ".35rem" }}>Dispute window</span>
              <div className="stack" style={{ marginBottom: ".4rem" }}>
                {DISPUTE_PRESETS.map((p) => (
                  <button key={p.secs} className={window_ === p.secs ? "primary" : ""} onClick={() => setWindow(p.secs)} style={{ textAlign: "start" }}>
                    <b>{p.label}</b><span className="note" style={{ display: "block" }}>{p.note}</span>
                  </button>
                ))}
              </div>
              <p className="note" style={{ marginBottom: "1rem" }}>It is also your time to settle: if you haven’t by the end, anyone can cancel the auction and your bond goes to the bidders.</p>
              {lotKind === LotKind.OffChain && (
                <>
                  <span className="eyebrow" style={{ display: "block", marginBottom: ".35rem" }}>Delivery window</span>
                  <div className="stack" style={{ marginBottom: "1rem" }}>
                    {DELIVERY_PRESETS.map((p) => (
                      <button key={p.secs} className={delivery === p.secs ? "primary" : ""} onClick={() => setDelivery(p.secs)} style={{ textAlign: "start" }}>
                        <b>{p.label}</b>{p.note && <span className="note" style={{ display: "block" }}>{p.note}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="panel" style={{ border: "2px solid var(--ink)" }}>
                <div className="spread"><b>Your reveal key for this auction</b><span className="lot-chip">Made in this browser</span></div>
                <p style={{ marginTop: ".5rem" }}>Bids are revealed to you on chain, encrypted to this key. Only you can read them. The key is made fresh for this auction and never leaves this browser unless you download it.</p>
                {key && <dl className="facts">
                  <div className="fact"><dt>Public key — goes into the listing</dt><dd className="mono">{key.publicX.slice(0, 6)}…{key.publicX.slice(-4)}</dd></div>
                  <div className="fact"><dt>Secret key — stays with you</dt><dd className="note">hidden</dd></div>
                </dl>}
                <div className="warnbox" style={{ margin: ".6rem 0" }}>
                  <b>Download it now.</b> Without it you can’t read the bids, so you can’t settle —
                  and an auction you can’t settle ends with your bond paid to the bidders. Once the
                  auction is final, delete it: anyone who ever gets it can read this auction’s bids.
                </div>
                <div className="row">
                  <button className="primary" disabled={!key}
                          onClick={() => key && download(`vickrey-reveal-key-${key.publicX.slice(2, 10)}.json`, revealKeyFile(key))}>Download reveal key</button>
                  <label style={{ display: "flex", gap: ".45rem", alignItems: "center", margin: 0 }}>
                    <input type="checkbox" checked={keySaved} onChange={(e) => setKeySaved(e.target.checked)} style={{ width: "auto" }} />
                    I’ve saved it somewhere I’ll have when bidding closes
                  </label>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <dl className="facts">
                <div className="fact"><dt>Lot</dt><dd>
                  {lotKind === LotKind.Erc20 && lotD && lotInfo ? showLot(toLotUnits(lotAmount || "0", lotD), lotD, lotInfo.symbol || "units")
                    : lotKind === LotKind.Erc721 ? `NFT #${tokenId}${nft.kind === "yours" && nft.name ? ` · ${nft.name}` : ""}`
                      : lotKind === LotKind.OffChain ? fields.what || "—" : "—"}</dd></div>
                <div className="fact"><dt>Priced in</dt><dd>{paySym}</dd></div>
                <div className="fact"><dt>Highest bid possible</dt><dd>{derived.cap ? showPay(derived.cap, payD!, paySym) : "—"}</dd></div>
                <div className="fact"><dt>Levels</dt><dd>{levels}</dd></div>
                <div className="fact"><dt>Bidding closes</dt><dd>{utcDate(Math.floor(Date.now() / 1000) + closeIn)}</dd></div>
                <div className="fact"><dt>Reveal window</dt><dd>{span(revealWin)}</dd></div>
                <div className="fact"><dt>Dispute window</dt><dd>{span(window_)}</dd></div>
                {lotKind === LotKind.OffChain && <div className="fact"><dt>Delivery window</dt><dd>{span(delivery)}</dd></div>}
                {lotKind === LotKind.OffChain && <div className="fact"><dt>Terms</dt><dd>{terms.length} characters</dd></div>}
                {lotKind === LotKind.OffChain && terms && <div className="fact"><dt>Terms hash</dt><dd className="mono">{(() => { const h = `0x${termsHash(terms).toString(16)}`; return `${h.slice(0, 6)}…${h.slice(-4)}`; })()}</dd></div>}
                <div className="fact"><dt>You pay in at listing</dt><dd>{payD ? showPay((bondUnits + sellerBondUnits) as never, payD, paySym) : "—"}
                  {payD && lotKind === LotKind.OffChain && <span className="note" style={{ display: "block" }}>
                    {showPay(bondUnits as never, payD, "")} auctioneer bond + {showPay(sellerBondUnits as never, payD, "")} seller bond.</span>}</dd></div>
              </dl>
              {!keySaved && <p className="err" style={{ marginTop: ".6rem" }}>Download and save the reveal key in step 4 first.</p>}
              {!lotOk && <p className="err" style={{ marginTop: ".6rem" }}>Step 1 isn’t complete.</p>}
              {err && <p className="err" style={{ marginTop: ".6rem" }}>{err}</p>}
              <button className="primary" style={{ marginTop: "1rem" }} onClick={() => void submit()} disabled={busy || !ready || !connection}>
                {busy ? "Waiting for your wallet…" : "Create auction"}
              </button>
            </>
          )}

          <div className="row" style={{ gap: ".6rem", marginTop: "1.4rem" }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
            {step < STEPS.length - 1 && (
              <button className="primary" onClick={() => setStep((s) => s + 1)}
                      disabled={(step === 0 && !lotOk) || (step === 1 && !!derived.error) || (step === 3 && !keySaved)}>
                Next
              </button>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="spread"><p className="eyebrow" style={{ margin: 0 }}>Preview</p><span className="note">step 2 · Ladder</span></div>
          {derived.error ? <p className="note" style={{ marginTop: ".6rem" }}>{derived.error}</p> : (
            <Ladder numLevels={levels} reservePrice={derived.reserve!} tick={derived.tick!}
                    symbol={paySym} decimals={payD ?? 18} bidCount={0} status={Status.Open} />
          )}
          <p className="note" style={{ marginTop: ".8rem" }}>
            {step === 1 ? "Redraws as you change the reserve, the top or the level count." : "Shows the ladder from step 2."}
          </p>
        </div>
      </div>
    </DashShell>
  );
}
