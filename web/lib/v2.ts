/**
 * Calldata for the v2 contracts.
 *
 * Pure: every function here takes values and returns calls, so the shapes are pinned by
 * `v2.test.ts` rather than discovered on chain. The order of every felt is the Cairo
 * signature's — `packages/auction/src/interface.cairo` and
 * `packages/anonymizer/src/interface.cairo` — and `AuctionConfig` is serialized exactly
 * as in v1 (pinned on the Cairo side by `test_layout`).
 */
import { hash, num, type Call, type STRK20_ACTION } from "starknet";
import type { AuctionKind } from "@vickrey/client";
import type { RevealKey, SealedReveal } from "@vickrey/client";

export enum LotKind { Erc20 = 0, Erc721 = 1, OffChain = 2 }
export enum DeliveryOutcome { None = 0, Pending = 1, Confirmed = 2, Rejected = 3, Released = 4 }
/** `get_open_note_screening_policy`, as the pool numbers it. */
export enum ScreeningPolicy { Required = 0, Exempt = 1, Delegated = 2 }
/** The v2 anonymizer's operations. v1's numbering differs; v1 is read-only here. */
export enum OperationV2 { PlaceBid = 0, Collect = 1, RedeemForfeit = 2 }

const hex = (x: bigint | number | string) => num.toHex(x);
const u256 = (x: bigint) => [hex(x & ((1n << 128n) - 1n)), hex(x >> 128n)];

/**
 * `ByteArray` as Cairo serializes it: `[n_full_words, ...words, pending, pending_len]`,
 * each word 31 bytes of UTF-8, big-endian.
 *
 * Built here rather than with starknet.js's `byteArrayFromString`, which in 10.4 leaks a
 * raw newline into its hex for any text containing one — and terms are multi-line. The
 * vector in `v2.test.ts` is asserted by the Cairo side too.
 */
export function byteArrayFelts(text: string): string[] {
  const bytes = new TextEncoder().encode(text);
  const word = (b: Uint8Array) => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
  const full = Math.floor(bytes.length / 31);
  const words: string[] = [];
  for (let i = 0; i < full; i++) words.push(hex(word(bytes.subarray(i * 31, i * 31 + 31))));
  const rest = bytes.subarray(full * 31);
  return [hex(full), ...words, hex(word(rest)), hex(rest.length)];
}

/** The inverse of `byteArrayFelts`, for text read out of an event. */
export function decodeByteArray(felts: Array<string | bigint>): string {
  const f = felts.map((x) => BigInt(x));
  const full = Number(f[0] ?? 0n);
  const bytes: number[] = [];
  const push = (w: bigint, len: number) => {
    for (let i = len - 1; i >= 0; i--) bytes.push(Number((w >> BigInt(8 * i)) & 0xffn));
  };
  for (let i = 0; i < full; i++) push(f[1 + i]!, 31);
  push(f[1 + full] ?? 0n, Number(f[2 + full] ?? 0n));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** What the contract stores as `terms_hash`: Poseidon over the serialized text. */
export const termsHash = (text: string): bigint =>
  BigInt(hash.computePoseidonHashOnElements(byteArrayFelts(text)));

export interface CreateParams {
  auction: string;
  seller: string;
  auctioneer: string;
  paymentToken: string;
  /** Zero for an off-chain lot. */
  lotToken: string;
  /** ERC-20: the amount. ERC-721: 1. Off-chain: 0. */
  lotAmount: bigint;
  kind: AuctionKind;
  reservePrice: bigint;
  tick: bigint;
  numLevels: number;
  bidDeadline: number;
  disputeWindow: number;
  auctioneerBond: bigint;
  /** Used only when `terms` is empty; otherwise the contract computes it. */
  termsHash: bigint;
  lotKind: LotKind;
  lotTokenId: bigint;
  revealKey: RevealKey;
  revealWindow: number;
  deliveryWindow: number;
  sellerBond: bigint;
  terms: string;
}

/** `create_auction(config, extras, terms)` calldata. */
export function createCalldata(p: CreateParams): string[] {
  return [
    // AuctionConfig, v1 order.
    hex(p.seller), hex(p.auctioneer), hex(p.paymentToken), hex(p.lotToken),
    hex(p.lotAmount), hex(p.kind), hex(p.reservePrice), hex(p.tick), hex(p.numLevels),
    hex(p.bidDeadline), hex(p.disputeWindow), hex(p.auctioneerBond), hex(p.termsHash),
    // AuctionExtras.
    hex(p.lotKind), ...u256(p.lotTokenId), hex(p.revealKey.x), hex(p.revealKey.y),
    hex(p.revealWindow), hex(p.deliveryWindow), hex(p.sellerBond),
    // terms: ByteArray
    ...byteArrayFelts(p.terms),
  ];
}

/**
 * The listing as one multicall: approve exactly what `create_auction` pulls, then list.
 * Approving the exact amounts, never the sum of unrelated tokens and never unbounded: an
 * approval left over is one somebody else can use.
 */
export function createCalls(p: CreateParams): Call[] {
  const calls: Call[] = [];
  let payNeeded = p.auctioneerBond + p.sellerBond;
  if (p.lotKind === LotKind.Erc20) {
    if (BigInt(p.lotToken) === BigInt(p.paymentToken)) {
      payNeeded += p.lotAmount;
    } else {
      calls.push({ contractAddress: p.lotToken, entrypoint: "approve",
        calldata: [hex(p.auction), ...u256(p.lotAmount)] });
    }
  }
  if (p.lotKind === LotKind.Erc721) {
    calls.push({ contractAddress: p.lotToken, entrypoint: "approve",
      calldata: [hex(p.auction), ...u256(p.lotTokenId)] });
  }
  calls.push({ contractAddress: p.paymentToken, entrypoint: "approve",
    calldata: [hex(p.auction), ...u256(payNeeded)] });
  calls.push({ contractAddress: p.auction, entrypoint: "create_auction",
    calldata: createCalldata(p) });
  return calls;
}

export const placeBidCalls = (
  auction: string, paymentToken: string, collateral: bigint, auctionId: bigint,
  commitment: bigint, up: bigint, down: bigint,
): Call[] => [
  { contractAddress: paymentToken, entrypoint: "approve",
    calldata: [hex(auction), ...u256(collateral)] },
  { contractAddress: auction, entrypoint: "place_bid",
    calldata: [hex(auctionId), hex(commitment), hex(up), hex(down)] },
];

export const postRevealCall = (
  auction: string, auctionId: bigint, bidIndex: number, s: SealedReveal,
): Call => ({
  contractAddress: auction, entrypoint: "post_reveal",
  calldata: [hex(auctionId), hex(bidIndex), hex(s.ephX), hex(s.cSeed), hex(s.cLevel)],
});

export const disputeCall = (
  auction: string, auctionId: bigint, bidIndex: number, r: bigint, cSeed: bigint, cLevel: bigint,
): Call => ({
  contractAddress: auction, entrypoint: "dispute",
  calldata: [hex(auctionId), hex(bidIndex), hex(r), hex(cSeed), hex(cLevel)],
});

export const collectCall = (
  auction: string, auctionId: bigint, bidIndex: number, claimSecret: bigint,
  recipient: string, lotRecipient: string,
): Call => ({
  contractAddress: auction, entrypoint: "collect",
  calldata: [hex(auctionId), hex(bidIndex), hex(claimSecret), hex(recipient), hex(lotRecipient)],
});

export const redeemForfeitCall = (
  auction: string, auctionId: bigint, bidIndex: number, claimSecret: bigint,
  witnessDown: bigint, recipient: string,
): Call => ({
  contractAddress: auction, entrypoint: "redeem_forfeit",
  calldata: [hex(auctionId), hex(bidIndex), hex(claimSecret), hex(witnessDown), hex(recipient)],
});

export const simpleCall = (
  auction: string,
  entrypoint: "seal" | "finalize" | "abandon" | "withdraw_seller" | "reclaim_lot"
    | "confirm_delivery" | "reject_delivery" | "release_proceeds",
  auctionId: bigint,
): Call => ({ contractAddress: auction, entrypoint, calldata: [hex(auctionId)] });

// ---- the private rail ---------------------------------------------------------------

export interface InvokeV2 {
  operation: OperationV2;
  auctionId: bigint;
  bidIndex?: number;
  claimCommitment?: bigint;
  upAnchor?: bigint;
  downAnchor?: bigint;
  claimSecret?: bigint;
  witnessDown?: bigint;
  /** A literal felt or the wallet placeholder `${openNoteIds[N]}`. */
  noteId?: string;
  lotNoteId?: string;
  lotRecipient?: string;
}

/** `privacy_invoke` calldata for the v2 anonymizer, in declaration order. */
export const invokeCalldataV2 = (a: InvokeV2): string[] => [
  hex(a.operation), hex(a.auctionId), hex(a.bidIndex ?? 0), hex(a.claimCommitment ?? 0n),
  hex(a.upAnchor ?? 0n), hex(a.downAnchor ?? 0n), hex(a.claimSecret ?? 0n),
  hex(a.witnessDown ?? 0n), a.noteId ?? hex(0), a.lotNoteId ?? hex(0),
  hex(a.lotRecipient ?? 0),
];

export const placeBidActionsV2 = (
  helper: string, paymentToken: string, collateral: bigint, auctionId: bigint,
  claimCommitment: bigint, upAnchor: bigint, downAnchor: bigint,
): STRK20_ACTION[] => [
  { type: "withdraw", token: hex(paymentToken), amount: hex(collateral), recipient: hex(helper) },
  { type: "invoke", contract: hex(helper), calldata: invokeCalldataV2({
    operation: OperationV2.PlaceBid, auctionId, claimCommitment, upAnchor, downAnchor }) },
];

/**
 * Which open notes a `Collect` leg fills, in the anonymizer's own order: the payment
 * token first if anything comes back in it, then an ERC-20 lot in a different token.
 *
 * Must match `auction_anonymizer.cairo` exactly: the pool refuses a transaction that
 * opens a note nothing fills (`UNDEPOSITED_OPEN_NOTES`) and refuses a zero deposit.
 */
export function collectNotes(o: {
  paymentToken: string;
  /** What `collect` pays in the payment token: escrow (+ bond share). */
  paymentOut: bigint;
  isWinner: boolean;
  lotKind: LotKind;
  lotToken: string;
  lotAmount: bigint;
}): string[] {
  const erc20Lot = o.isWinner && o.lotKind === LotKind.Erc20;
  const sameToken = erc20Lot && BigInt(o.lotToken) === BigInt(o.paymentToken);
  const payTotal = o.paymentOut + (sameToken ? o.lotAmount : 0n);
  const notes: string[] = [];
  if (payTotal > 0n) notes.push(o.paymentToken);
  if (erc20Lot && !sameToken && o.lotAmount > 0n) notes.push(o.lotToken);
  return notes;
}

export function collectActionsV2(o: {
  helper: string;
  owner: string;
  auctionId: bigint;
  bidIndex: number;
  claimSecret: bigint;
  notes: string[];
  paymentToken: string;
  /** Public address for an NFT or off-chain lot. Zero otherwise. */
  lotRecipient?: string;
}): STRK20_ACTION[] {
  const actions: STRK20_ACTION[] = o.notes.map((token) => ({
    type: "transfer", token: hex(token), amount: "OPEN", recipient: hex(o.owner),
  }));
  const payIdx = o.notes.findIndex((t) => BigInt(t) === BigInt(o.paymentToken));
  const lotIdx = o.notes.findIndex((t, i) => i !== payIdx);
  actions.push({ type: "invoke", contract: hex(o.helper), calldata: invokeCalldataV2({
    operation: OperationV2.Collect,
    auctionId: o.auctionId,
    bidIndex: o.bidIndex,
    claimSecret: o.claimSecret,
    noteId: payIdx >= 0 ? `\${openNoteIds[${payIdx}]}` : undefined,
    lotNoteId: lotIdx >= 0 ? `\${openNoteIds[${lotIdx}]}` : undefined,
    lotRecipient: o.lotRecipient,
  }) });
  return actions;
}

export const redeemActionsV2 = (o: {
  helper: string; owner: string; paymentToken: string; auctionId: bigint; bidIndex: number;
  claimSecret: bigint; witnessDown: bigint;
}): STRK20_ACTION[] => [
  { type: "transfer", token: hex(o.paymentToken), amount: "OPEN", recipient: hex(o.owner) },
  { type: "invoke", contract: hex(o.helper), calldata: invokeCalldataV2({
    operation: OperationV2.RedeemForfeit, auctionId: o.auctionId, bidIndex: o.bidIndex,
    claimSecret: o.claimSecret, witnessDown: o.witnessDown, noteId: "${openNoteIds[0]}" }) },
];

// ---- whether a private collect would be accepted -------------------------------------

export type PrivateCollect =
  | { verdict: "available" }
  | { verdict: "unavailable"; policy: ScreeningPolicy }
  | { verdict: "unknown"; why: string };

/**
 * The pool's screening policy for our anonymizer, as a decision.
 *
 * Only `Exempt` makes a private collect safe to send. `Required` and `Delegated` both
 * mean the pool would screen the anonymizer itself, and nothing says the screener would
 * attest a contract — a refused collect still publishes the claim secret, so they are
 * unavailable. A read that fails is an unknown, never a guess.
 */
export function privateCollectVerdict(read: { result: string[] } | { error: string }): PrivateCollect {
  if ("error" in read) return { verdict: "unknown", why: read.error };
  const raw = read.result[0];
  if (raw === undefined) return { verdict: "unknown", why: "the pool returned nothing" };
  const v = Number(BigInt(raw));
  if (v === ScreeningPolicy.Exempt) return { verdict: "available" };
  if (v === ScreeningPolicy.Required || v === ScreeningPolicy.Delegated) {
    return { verdict: "unavailable", policy: v };
  }
  return { verdict: "unknown", why: `the pool returned an unknown policy (${raw})` };
}
