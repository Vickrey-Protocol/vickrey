/**
 * Isomorphic on purpose. The auction's structure — level count, price scale, rungs —
 * is configuration, not live state, so the server renders it into the HTML and the
 * instrument is on screen before any client fetch happens.
 */
import { byteArray, RpcProvider, shortString } from "starknet";
import {
  type AuctionKind,
  type AuctionTerms,
  type DispositionProof,
  type PublicBid,
  poolFee as readPoolFee,
  type Status,
} from "@vickrey/client";
import { config } from "./config";

export const provider = () => new RpcProvider({ nodeUrl: config.rpcUrl });

export interface AuctionView {
  terms: AuctionTerms;
  status: Status;
  seller: string;
  auctioneer: string;
  paymentToken: string;
  paymentSymbol: string;
  lotToken: string;
  lotSymbol: string;
  lotAmount: bigint;
  bidDeadline: number;
  disputeWindow: number;
  disputeDeadline: number;
  bidCount: number;
  bidRoot: bigint;
  clearingLevel: number;
  winnerIndex: number;
  collateral: bigint;
  bond: bigint;
  lotClaimed: boolean;
  /** Read live from the pool; never hardcoded. Null while loading or unavailable. */
  poolFee: bigint | null;
}

const n = (x: string) => BigInt(x);

/**
 * Token symbols come back two different ways and getting it wrong is silent.
 *
 * Modern SNIP-2 tokens (STRK included) return a **ByteArray**:
 * `[num_full_words, ...words, pending_word, pending_word_len]`. Older ones return a
 * single felt252 short string. Reading the last felt of a ByteArray yields its
 * *length*, which renders as a plausible-looking "4" rather than an obvious error.
 */
async function symbolOf(p: RpcProvider, token: string): Promise<string> {
  const printable = (s: string) => (/^[\x20-\x7e]{1,16}$/.test(s) ? s : null);
  try {
    const r = await p.callContract({ contractAddress: token, entrypoint: "symbol", calldata: [] });
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

export async function readAuction(id: bigint): Promise<AuctionView | null> {
  const p = provider();
  const call = (entrypoint: string, calldata: string[] = []) =>
    p.callContract({ contractAddress: config.auctionAddress, entrypoint, calldata });

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

  const [collateral, paymentSymbol, lotSymbol, fee] = await Promise.all([
    call("collateral", [id.toString()]).then((r) => n(r[0]!)),
    symbolOf(p, paymentToken),
    symbolOf(p, lotToken),
    config.poolAddress
      ? readPoolFee(p as never, config.poolAddress).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    terms,
    seller: cfg[0]!,
    auctioneer: cfg[1]!,
    paymentToken,
    paymentSymbol,
    lotToken,
    lotSymbol,
    lotAmount: n(cfg[4]!),
    bidDeadline: Number(n(cfg[9]!)),
    disputeWindow: Number(n(cfg[10]!)),
    bond: n(cfg[11]!),
    status: Number(n(st[0]!)) as Status,
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

export async function readBids(id: bigint, count: number): Promise<PublicBid[]> {
  const p = provider();
  const out: PublicBid[] = [];
  for (let index = 0; index < count; index++) {
    const r = await p.callContract({
      contractAddress: config.auctionAddress,
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

export async function readAuctionCount(): Promise<number> {
  const r = await provider().callContract({
    contractAddress: config.auctionAddress,
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
export async function readAll(): Promise<AuctionView[]> {
  const count = await readAuctionCount();
  const views = await Promise.all(
    Array.from({ length: count }, (_, i) => readAuction(BigInt(i))),
  );
  return views.filter((v): v is AuctionView => v !== null);
}

/** `AuctionView` carries bigints, which do not survive the server/client boundary. */
export type WireAuction = Omit<
  AuctionView,
  "terms" | "lotAmount" | "collateral" | "bond" | "bidRoot" | "poolFee"
> & {
  terms: Omit<AuctionView["terms"], "auctionId" | "reservePrice" | "tick"> & {
    auctionId: string; reservePrice: string; tick: string;
  };
  lotAmount: string; collateral: string; bond: string; bidRoot: string;
  poolFee: string | null;
};

export const toWire = (a: AuctionView): WireAuction => ({
  ...a,
  terms: {
    ...a.terms,
    auctionId: a.terms.auctionId.toString(),
    reservePrice: a.terms.reservePrice.toString(),
    tick: a.terms.tick.toString(),
  },
  lotAmount: a.lotAmount.toString(),
  collateral: a.collateral.toString(),
  bond: a.bond.toString(),
  bidRoot: a.bidRoot.toString(),
  poolFee: a.poolFee === null ? null : a.poolFee.toString(),
});

export const fromWire = (w: WireAuction): AuctionView => ({
  ...w,
  terms: {
    ...w.terms,
    auctionId: BigInt(w.terms.auctionId),
    reservePrice: BigInt(w.terms.reservePrice),
    tick: BigInt(w.terms.tick),
  },
  lotAmount: BigInt(w.lotAmount),
  collateral: BigInt(w.collateral),
  bond: BigInt(w.bond),
  bidRoot: BigInt(w.bidRoot),
  poolFee: w.poolFee === null ? null : BigInt(w.poolFee),
});
