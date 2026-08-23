"use client";

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
