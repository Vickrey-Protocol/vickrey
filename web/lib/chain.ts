"use client";

import { Contract, RpcProvider, type Abi } from "starknet";
import {
  AuctionKind,
  type AuctionTerms,
  type DispositionProof,
  type PublicBid,
  Status,
} from "@vickrey/client";
import { config } from "./config";

export const provider = () => new RpcProvider({ nodeUrl: config.rpcUrl });

/** Hand-written ABI fragment: only the entry points the app actually uses. */
export const AUCTION_ABI = [
  {
    type: "function",
    name: "auction_count",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "collateral",
    inputs: [{ name: "auction_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::integer::u128" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "price_of_level",
    inputs: [
      { name: "auction_id", type: "core::integer::u64" },
      { name: "level", type: "core::integer::u16" },
    ],
    outputs: [{ type: "core::integer::u128" }],
    state_mutability: "view",
  },
] as const satisfies Abi;

export interface AuctionView {
  terms: AuctionTerms;
  status: Status;
  seller: string;
  auctioneer: string;
  paymentToken: string;
  lotToken: string;
  lotAmount: bigint;
  bidDeadline: number;
  disputeDeadline: number;
  bidCount: number;
  bidRoot: bigint;
  clearingLevel: number;
  winnerIndex: number;
  collateral: bigint;
}

const felt = (x: string | bigint) => BigInt(x);

/**
 * Reads an auction through raw `callContract` rather than a generated typing, so the
 * app stays readable against a hand-written ABI fragment.
 */
export async function readAuction(id: bigint): Promise<AuctionView | null> {
  const p = provider();
  const call = (entrypoint: string, calldata: string[]) =>
    p.callContract({ contractAddress: config.auctionAddress, entrypoint, calldata });

  let cfg: string[];
  try {
    cfg = await call("get_config", [id.toString()]);
  } catch {
    return null;
  }
  const st = await call("get_state", [id.toString()]);

  // AuctionConfig, in declaration order.
  const [
    seller,
    auctioneer,
    paymentToken,
    lotToken,
    lotAmount,
    kind,
    reservePrice,
    tick,
    numLevels,
    bidDeadline,
  ] = cfg as [string, string, string, string, string, string, string, string, string, string];

  const terms: AuctionTerms = {
    auctionId: id,
    kind: Number(felt(kind!)) as AuctionKind,
    reservePrice: felt(reservePrice!),
    tick: felt(tick!),
    numLevels: Number(felt(numLevels!)),
  };

  return {
    terms,
    seller: seller!,
    auctioneer: auctioneer!,
    paymentToken: paymentToken!,
    lotToken: lotToken!,
    lotAmount: felt(lotAmount!),
    bidDeadline: Number(felt(bidDeadline!)),
    status: Number(felt(st[0]!)) as Status,
    bidCount: Number(felt(st[1]!)),
    bidRoot: felt(st[2]!),
    clearingLevel: Number(felt(st[5]!)),
    winnerIndex: Number(felt(st[6]!)),
    disputeDeadline: Number(felt(st[8]!)),
    collateral: felt((await call("collateral", [id.toString()]))[0]!),
  };
}

export async function readBids(id: bigint, count: number): Promise<PublicBid[]> {
  const p = provider();
  const out: PublicBid[] = [];
  for (let index = 0; index < count; index++) {
    const r = await p.callContract({
      contractAddress: config.auctionAddress,
      entrypoint: "get_bid",
      calldata: [id.toString(), index.toString()],
    });
    out.push({
      index,
      claimCommitment: felt(r[0]!),
      upAnchor: felt(r[1]!),
      downAnchor: felt(r[2]!),
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
  const flat: string[] = [
    id.toString(),
    clearingLevel.toString(),
    winnerIndex.toString(),
    proofs.length.toString(),
  ];
  for (const p of proofs) {
    flat.push(p.kind.toString(), p.witnessUp.toString(), p.witnessDown.toString());
  }
  return flat;
}
