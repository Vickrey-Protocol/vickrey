/**
 * Isomorphic on purpose. The auction's structure — level count, price scale, rungs —
 * is configuration, not live state, so the server renders it into the HTML and the
 * instrument is on screen before any client fetch happens.
 */
import { byteArray, hash, num, RpcProvider, shortString } from "starknet";
import {
  type AuctionKind,
  type AuctionTerms,
  type DispositionProof,
  type PublicBid,
  type Disposition,
  poolFee as readPoolFee,
  type Status,
} from "@vickrey/client";
import { config } from "./config";
import { lotRail, type LotRail } from "./lotRail";
import {
  DeliveryOutcome, LotKind, decodeByteArray, privateCollectVerdict, termsHash,
  type PrivateCollect,
} from "./v2";

export const provider = () => new RpcProvider({ nodeUrl: config.rpcUrl });

/** Which contract an auction lives on. v1 is read-only on this site. */
export type ContractVersion = 1 | 2;

export const contractFor = (version: ContractVersion) =>
  version === 2 ? config.auctionAddress : config.legacyAuctionAddress;

export interface Delivery {
  buyer: string;
  deadline: number;
  outcome: DeliveryOutcome;
  price: bigint;
}

export interface AuctionView {
  version: ContractVersion;
  /** The auction contract's address. Every read and call for this auction goes here. */
  contract: string;
  terms: AuctionTerms;
  status: Status;
  seller: string;
  auctioneer: string;
  paymentToken: string;
  paymentSymbol: string;
  /** Read from the token, never assumed. USDC is 6, not 18. */
  paymentDecimals: number;
  lotToken: string;
  lotSymbol: string;
  lotDecimals: number;
  lotAmount: bigint;
  bidDeadline: number;
  disputeWindow: number;
  disputeDeadline: number;
  /** Stamped from the block by `seal`. The grace before `abandon` counts from here. */
  sealedAtTime: number;
  bidCount: number;
  bidRoot: bigint;
  clearingLevel: number;
  winnerIndex: number;
  collateral: bigint;
  bond: bigint;
  lotClaimed: boolean;
  /** Read live from the pool; never hardcoded. Null while loading or unavailable. */
  poolFee: bigint | null;
  /** v2's extras. A v1 auction reads as an ERC-20 lot with none of the rest. */
  lotKind: LotKind;
  lotTokenId: bigint;
  /** The NFT collection's name, when it has one. */
  lotName: string;
  revealKeyX: bigint;
  revealKeyY: bigint;
  revealWindow: number;
  deliveryWindow: number;
  sellerBond: bigint;
  termsHash: bigint;
  sealedAtBlock: number;
  /** Off-chain lots after finalize. */
  delivery: Delivery | null;
  sellerOwed: bigint;
  lotReclaimable: boolean;
}

/** When reveals stop being accepted and `settle` becomes possible. Zero before seal. */
export const revealDeadline = (a: AuctionView) =>
  a.sealedAtTime > 0 ? a.sealedAtTime + a.revealWindow : 0;

/** When `abandon` becomes possible: the reveal window, then the settle grace. */
export const abandonAt = (a: AuctionView) =>
  a.sealedAtTime > 0 ? a.sealedAtTime + a.revealWindow + a.disputeWindow : 0;

const n = (x: string) => BigInt(x);

/**
 * Token symbols come back two different ways and getting it wrong is silent.
 *
 * Modern SNIP-2 tokens (STRK included) return a **ByteArray**:
 * `[num_full_words, ...words, pending_word, pending_word_len]`. Older ones return a
 * single felt252 short string. Reading the last felt of a ByteArray yields its
 * *length*, which renders as a plausible-looking "4" rather than an obvious error.
 */
/** `name()`, decoded the same way as `symbol()` — the ByteArray trap is identical. */
export async function nameOf(p: RpcProvider, token: string): Promise<string> {
  return textOf(p, token, "name");
}

export async function symbolOf(p: RpcProvider, token: string): Promise<string> {
  return textOf(p, token, "symbol");
}

async function textOf(p: RpcProvider, token: string, entrypoint: string): Promise<string> {
  const printable = (s: string) => (/^[\x20-\x7e]{1,16}$/.test(s) ? s : null);
  try {
    const r = await p.callContract({ contractAddress: token, entrypoint, calldata: [] });
    if (r.length === 1) return printable(shortString.decodeShortString(r[0]!)) ?? "tokens";
    const numFullWords = Number(BigInt(r[0]!));
    const data = r.slice(1, 1 + numFullWords);
    const decoded = byteArray.stringFromByteArray({
      data,
      pending_word: r[1 + numFullWords] ?? "0x0",
      pending_word_len: Number(BigInt(r[2 + numFullWords] ?? "0x0")),
    });
    return printable(decoded) ?? "tokens";
  } catch {
    return "tokens";
  }
}

/**
 * A token's decimals, read rather than assumed.
 *
 * Everything here used to default to 18, which is right for STRK and ETH and wrong for
 * USDC — six decimals, so a balance of 1.0 would have rendered as 0.000000000001. The
 * default was correct only by luck, and the luck runs out the first time an auction is
 * denominated in anything else. The payment token is a constructor parameter, so that
 * is a configuration choice away, not a rewrite away.
 *
 * 18 remains the fallback for a token that will not answer, because it is the common
 * case — but it is a fallback now, not an assumption.
 */
async function decimalsOf(p: RpcProvider, token: string): Promise<number> {
  try {
    const r = await p.callContract({ contractAddress: token, entrypoint: "decimals", calldata: [] });
    const d = Number(BigInt(r[0]!));
    return Number.isFinite(d) && d >= 0 && d <= 32 ? d : 18;
  } catch {
    return 18;
  }
}

export async function readAuction(
  id: bigint, version: ContractVersion = 2,
): Promise<AuctionView | null> {
  const p = provider();
  const contract = contractFor(version);
  const call = (entrypoint: string, calldata: string[] = []) =>
    p.callContract({ contractAddress: contract, entrypoint, calldata });

  let cfg: string[];
  try {
    cfg = await call("get_config", [id.toString()]);
  } catch {
    return null;
  }
  const st = await call("get_state", [id.toString()]);

  const paymentToken = cfg[2]!;
  const lotToken = cfg[3]!;
  const terms: AuctionTerms = {
    auctionId: id,
    kind: Number(n(cfg[5]!)) as AuctionKind,
    reservePrice: n(cfg[6]!),
    tick: n(cfg[7]!),
    numLevels: Number(n(cfg[8]!)),
  };

  /* v2 only. The extras decide what the lot is, and so how to read it. */
  const ex = version === 2 ? await call("get_extras", [id.toString()]) : null;
  const lotKind = ex ? (Number(n(ex[0]!)) as LotKind) : LotKind.Erc20;
  const isToken = lotKind === LotKind.Erc20;
  const isNft = lotKind === LotKind.Erc721;

  const [collateral, paymentSymbol, lotSymbol, paymentDecimals, lotDecimals, fee, lotName,
    delivery, sellerOwed, lotReclaimable] = await Promise.all([
    call("collateral", [id.toString()]).then((r) => n(r[0]!)),
    symbolOf(p, paymentToken),
    isToken || isNft ? symbolOf(p, lotToken) : Promise.resolve(""),
    decimalsOf(p, paymentToken),
    /* An NFT has no decimals, and an off-chain lot has no contract at all. Asking would
       return a plausible-looking fallback; not asking returns the truth. */
    isToken ? decimalsOf(p, lotToken) : Promise.resolve(0),
    config.poolAddress
      ? readPoolFee(p as never, config.poolAddress).catch(() => null)
      : Promise.resolve(null),
    isNft ? nameOf(p, lotToken) : Promise.resolve(""),
    lotKind === LotKind.OffChain
      ? call("get_delivery", [id.toString()]).then((r): Delivery | null => {
        const outcome = Number(n(r[2]!)) as DeliveryOutcome;
        return outcome === DeliveryOutcome.None ? null : {
          buyer: r[0]!, deadline: Number(n(r[1]!)), outcome, price: n(r[3]!),
        };
      })
      : Promise.resolve(null),
    version === 2 ? call("seller_owed", [id.toString()]).then((r) => n(r[0]!)) : Promise.resolve(0n),
    version === 2
      ? call("lot_reclaimable", [id.toString()]).then((r) => n(r[0]!) !== 0n)
      : Promise.resolve(false),
  ]);

  return {
    version,
    contract,
    lotKind,
    lotTokenId: ex ? n(ex[1]!) + (n(ex[2]!) << 128n) : 0n,
    lotName,
    revealKeyX: ex ? n(ex[3]!) : 0n,
    revealKeyY: ex ? n(ex[4]!) : 0n,
    revealWindow: ex ? Number(n(ex[5]!)) : 0,
    deliveryWindow: ex ? Number(n(ex[6]!)) : 0,
    sellerBond: ex ? n(ex[7]!) : 0n,
    termsHash: n(cfg[12]!),
    sealedAtBlock: Number(n(st[3]!)),
    delivery,
    sellerOwed,
    lotReclaimable,
    terms,
    seller: cfg[0]!,
    auctioneer: cfg[1]!,
    paymentToken,
    paymentSymbol,
    paymentDecimals,
    lotToken,
    lotSymbol,
    lotDecimals,
    lotAmount: n(cfg[4]!),
    bidDeadline: Number(n(cfg[9]!)),
    disputeWindow: Number(n(cfg[10]!)),
    bond: n(cfg[11]!),
    status: Number(n(st[0]!)) as Status,
    sealedAtTime: Number(n(st[4]!)),
    bidCount: Number(n(st[1]!)),
    bidRoot: n(st[2]!),
    clearingLevel: Number(n(st[5]!)),
    winnerIndex: Number(n(st[6]!)),
    disputeDeadline: Number(n(st[8]!)),
    lotClaimed: n(st[9]!) === 1n,
    collateral,
    poolFee: fee,
  };
}

export async function readBids(
  id: bigint, count: number, contract: string = config.auctionAddress,
): Promise<PublicBid[]> {
  const p = provider();
  const out: PublicBid[] = [];
  for (let index = 0; index < count; index++) {
    const r = await p.callContract({
      contractAddress: contract,
      entrypoint: "get_bid",
      calldata: [id.toString(), String(index)],
    });
    out.push({
      index,
      claimCommitment: n(r[0]!),
      upAnchor: n(r[1]!),
      downAnchor: n(r[2]!),
    });
  }
  return out;
}

/**
 * The parts of a bid the *bidder* needs and the anchors do not carry.
 *
 * `get_bid` returns the whole `Bid` struct, of which `readBids` above keeps only the
 * three commitment felts — everything a spectator is entitled to. The claim screen needs
 * two more, because which collect call will succeed depends entirely on them:
 * `claim_refund` refuses a forfeited bid on a finalized auction, and `redeem_forfeit`
 * refuses anything else. Offering both and letting the user find out is how you get a
 * revert on the screen whose whole job is releasing their money.
 *
 * Layout, in felts: claim_commitment, up_anchor, down_anchor, escrow (u128, one felt),
 * disposition, claimed.
 */
export interface BidState {
  index: number;
  /** The bid's only identity. `poseidon([CLAIM_TAG, claim_secret])`. */
  claimCommitment: bigint;
  escrow: bigint;
  disposition: Disposition;
  claimed: boolean;
}

export async function readBidState(
  id: bigint, index: number, contract: string = config.auctionAddress,
): Promise<BidState> {
  const r = await provider().callContract({
    contractAddress: contract,
    entrypoint: "get_bid",
    calldata: [id.toString(), String(index)],
  });
  return {
    index,
    claimCommitment: n(r[0]!),
    escrow: n(r[3]!),
    disposition: Number(n(r[4]!)) as Disposition,
    claimed: n(r[5]!) !== 0n,
  };
}

/**
 * Where a commitment actually sits, asked of the chain.
 *
 * A stored index is a guess until this confirms it. Returns the index whose bid carries
 * this commitment, or `null` if no bid in the auction does — which is what a phantom
 * looks like. Throws on an unreadable chain rather than returning null, because "we could
 * not ask" and "it is not there" must not collapse into one answer.
 */
export async function findBidIndex(
  auctionId: bigint, bidCount: number, commitment: bigint,
): Promise<number | null> {
  for (let i = 0; i < bidCount; i++) {
    const st = await readBidState(auctionId, i);
    if (st.claimCommitment === commitment) return i;
  }
  return null;
}

/**
 * The live bid count for one auction, read on its own.
 *
 * The dashboard's auction list is a poll, so its `bidCount` lags the chain by exactly the
 * bid that was just placed. Anything deciding whether a stored bid exists has to ask the
 * chain at that moment: a search bounded by a lagging count cannot reach the newest bid,
 * and the "not found" it returns is about the bound, not about the chain.
 */
export async function readBidCount(auctionId: bigint): Promise<number> {
  const r = await provider().callContract({
    contractAddress: config.auctionAddress,
    entrypoint: "get_state",
    calldata: [auctionId.toString()],
  });
  return Number(BigInt(r[1]!));
}

export async function readAuctionCount(contract: string = config.auctionAddress): Promise<number> {
  const r = await provider().callContract({
    contractAddress: contract,
    entrypoint: "auction_count",
    calldata: [],
  });
  return Number(BigInt(r[0]!));
}

/** Calldata for `settle`, with the proof span flattened as the ABI expects. */
export function settleCalldata(
  id: bigint,
  clearingLevel: number,
  winnerIndex: number,
  proofs: DispositionProof[],
): string[] {
  const flat = [id.toString(), String(clearingLevel), String(winnerIndex), String(proofs.length)];
  for (const p of proofs) {
    flat.push(String(p.kind), p.witnessUp.toString(), p.witnessDown.toString());
  }
  return flat;
}


/** Everything the page needs, fetched in one pass. Used by the server render. */
export async function readAll(version: ContractVersion = 2): Promise<AuctionView[]> {
  const contract = contractFor(version);
  if (!contract) return [];
  const count = await readAuctionCount(contract);
  const views = await Promise.all(
    Array.from({ length: count }, (_, i) => readAuction(BigInt(i), version)),
  );
  return views.filter((v): v is AuctionView => v !== null);
}

/** `AuctionView` carries bigints, which do not survive the server/client boundary. */
type BigKeys = "lotAmount" | "collateral" | "bond" | "bidRoot" | "lotTokenId" | "revealKeyX"
  | "revealKeyY" | "sellerBond" | "termsHash" | "sellerOwed";
const BIG_KEYS: BigKeys[] = ["lotAmount", "collateral", "bond", "bidRoot", "lotTokenId",
  "revealKeyX", "revealKeyY", "sellerBond", "termsHash", "sellerOwed"];

export type WireAuction = Omit<AuctionView, "terms" | "poolFee" | "delivery" | BigKeys> & {
  terms: Omit<AuctionView["terms"], "auctionId" | "reservePrice" | "tick"> & {
    auctionId: string; reservePrice: string; tick: string;
  };
  poolFee: string | null;
  delivery: (Omit<Delivery, "price"> & { price: string }) | null;
} & Record<BigKeys, string>;

export const toWire = (a: AuctionView): WireAuction => ({
  ...a,
  ...(Object.fromEntries(BIG_KEYS.map((k) => [k, a[k].toString()])) as Record<BigKeys, string>),
  terms: {
    ...a.terms,
    auctionId: a.terms.auctionId.toString(),
    reservePrice: a.terms.reservePrice.toString(),
    tick: a.terms.tick.toString(),
  },
  poolFee: a.poolFee === null ? null : a.poolFee.toString(),
  delivery: a.delivery ? { ...a.delivery, price: a.delivery.price.toString() } : null,
});

export const fromWire = (w: WireAuction): AuctionView => ({
  ...w,
  ...(Object.fromEntries(BIG_KEYS.map((k) => [k, BigInt(w[k])])) as Record<BigKeys, bigint>),
  terms: {
    ...w.terms,
    auctionId: BigInt(w.terms.auctionId),
    reservePrice: BigInt(w.terms.reservePrice),
    tick: BigInt(w.terms.tick),
  },
  poolFee: w.poolFee === null ? null : BigInt(w.poolFee),
  delivery: w.delivery ? { ...w.delivery, price: BigInt(w.delivery.price) } : null,
});

/**
 * How the lot of a finished auction was collected: through the pool or to a public
 * address. Found from the `LotClaimed` event's own transaction (see `lib/lotRail.ts`).
 *
 * The search starts at the seal block, which `get_state` records — a lot cannot be
 * claimed before the auction is sealed — so it is a page or two, not the whole chain.
 * Returns null when it cannot tell; the caller then says "collected" and nothing more.
 */
export async function readLotCollection(
  id: bigint, contract: string = config.auctionAddress,
): Promise<LotRail | null> {
  if (!config.anonymizerAddress) return null;
  const p = provider();
  const st = await p.callContract({
    contractAddress: contract, entrypoint: "get_state", calldata: [id.toString()],
  });
  const sealedAtBlock = Number(n(st[3]!));
  let token: string | undefined;
  for (let page = 0; page < 40; page++) {
    const r = await p.getEvents({
      address: contract,
      keys: [[hash.getSelectorFromName("LotClaimed")], [num.toHex(id)]],
      from_block: { block_number: sealedAtBlock },
      to_block: "latest",
      chunk_size: 100,
      continuation_token: token,
    });
    const ev = r.events[0];
    if (ev) {
      const rcpt = await p.getTransactionReceipt(ev.transaction_hash);
      const events = (rcpt as { events?: Array<{ from_address: string }> }).events ?? [];
      return lotRail(events, config.anonymizerAddress);
    }
    token = r.continuation_token;
    if (!token) return null;
  }
  return null;
}

// ---- v2 reads ------------------------------------------------------------------------

/** Every event of one kind for one auction, from `fromBlock`, oldest first. */
async function eventsFor(
  contract: string, name: string, auctionId: bigint, fromBlock: number, max = 200,
): Promise<Array<{ keys: string[]; data: string[]; transaction_hash: string }>> {
  const p = provider();
  const out: Array<{ keys: string[]; data: string[]; transaction_hash: string }> = [];
  let token: string | undefined;
  for (let page = 0; page < 60; page++) {
    const r = await p.getEvents({
      address: contract,
      keys: [[hash.getSelectorFromName(name)], [num.toHex(auctionId)]],
      from_block: { block_number: fromBlock },
      to_block: "latest",
      chunk_size: 100,
      continuation_token: token,
    });
    out.push(...r.events);
    token = r.continuation_token;
    if (!token || out.length >= max) break;
  }
  return out;
}

export interface Terms {
  text: string;
  /** The text's hash equals the `terms_hash` the contract stores. */
  verified: boolean;
}

/**
 * The off-chain lot's terms, read from the `LotTerms` event and checked against the
 * hash in the config. Null when no terms were published.
 */
export async function readTerms(a: AuctionView): Promise<Terms | null> {
  const evs = await eventsFor(a.contract, "LotTerms", a.terms.auctionId, config.auctionDeployBlock, 1);
  const ev = evs[0];
  if (!ev) return null;
  const text = decodeByteArray(ev.data);
  return { text, verified: termsHash(text) === a.termsHash };
}

export interface PostedReveal { bidIndex: number; ephX: bigint; cSeed: bigint; cLevel: bigint }

/** Every reveal posted on chain for an auction. Only the auctioneer can read them. */
export async function readPostedReveals(a: AuctionView): Promise<PostedReveal[]> {
  const evs = await eventsFor(a.contract, "RevealPosted", a.terms.auctionId,
    a.sealedAtBlock || config.auctionDeployBlock, 2000);
  return evs.map((e) => ({
    bidIndex: Number(BigInt(e.keys[2]!)),
    ephX: BigInt(e.data[0]!), cSeed: BigInt(e.data[1]!), cLevel: BigInt(e.data[2]!),
  }));
}

/** Whether exactly this reveal has been posted for this bid. */
export async function isRevealPosted(
  a: AuctionView, bidIndex: number, r: { ephX: bigint; cSeed: bigint; cLevel: bigint },
): Promise<boolean> {
  const res = await provider().callContract({
    contractAddress: a.contract, entrypoint: "reveal_posted",
    calldata: [a.terms.auctionId.toString(), String(bidIndex), num.toHex(r.ephX),
      num.toHex(r.cSeed), num.toHex(r.cLevel)],
  });
  return BigInt(res[0]!) !== 0n;
}

/** `bid_index_of`: the bid carrying this anchor, or null. Throws on a failed read. */
export async function bidIndexOf(a: AuctionView, anchor: bigint): Promise<number | null> {
  const r = await provider().callContract({
    contractAddress: a.contract, entrypoint: "bid_index_of",
    calldata: [a.terms.auctionId.toString(), num.toHex(anchor)],
  });
  const i = Number(BigInt(r[0]!));
  return i === 0xffffffff ? null : i;
}

/** Whether the pool would accept a private collect right now. Never throws. */
export async function readPrivateCollect(): Promise<PrivateCollect> {
  if (!config.poolAddress || !config.anonymizerAddress) {
    return { verdict: "unknown", why: "no pool or anonymizer is configured" };
  }
  try {
    const result = await provider().callContract({
      contractAddress: config.poolAddress, entrypoint: "get_open_note_screening_policy",
      calldata: [config.anonymizerAddress],
    });
    return privateCollectVerdict({ result });
  } catch (e) {
    return privateCollectVerdict({ error: e instanceof Error ? e.message.slice(0, 160) : String(e) });
  }
}

/** The current owner of an NFT. Throws on a failed read. */
export async function ownerOf(collection: string, tokenId: bigint): Promise<string> {
  const r = await provider().callContract({
    contractAddress: collection, entrypoint: "owner_of",
    calldata: [num.toHex(tokenId & ((1n << 128n) - 1n)), num.toHex(tokenId >> 128n)],
  });
  return r[0]!;
}
