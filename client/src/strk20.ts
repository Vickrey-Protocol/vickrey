/**
 * Assembling the pool transactions.
 *
 * Both layers here are now verified rather than inferred:
 *
 * 1. **The action envelope** — typed against `STRK20_ACTION` as shipped in
 *    `@starknet-io/starknet-types-0103` (the Wallet API 0.10.3 types that
 *    `starknet@10.4.0` vendors). `withdraw` takes `{ token, amount, recipient }` and
 *    moves pool funds to a public recipient, which is how the collateral reaches the
 *    helper; `transfer` with the literal `"OPEN"` mints the open note a claim is
 *    credited into; `invoke` carries calldata that may contain the wallet-resolved
 *    placeholders `${openNoteIds[N]}` and `${poolAddress}`.
 *
 * 2. **The `privacy_invoke` calldata** — the pool deserializes it straight into the
 *    helper's parameters, and the order below is pinned field for field by
 *    `packages/anonymizer/tests/test_layout.cairo`. The pool reaches the helper
 *    through `INVOKE_SELECTOR = selector!("privacy_invoke")`, verified against
 *    `starkware-libs/starknet-privacy` @ 36eac4ea.
 *
 * Every felt is emitted through `num.toHex`, because `FELT` is prefixed hex with no
 * leading zeros (`^0x(0|[a-fA-F1-9][a-fA-F0-9]{0,62})$`). A decimal string is rejected
 * by the wallet.
 */
import { num, type STRK20_ACTION } from "starknet";
import { AuctionOperation } from "./types";

/** Prefixed hex, no leading zeros — the shape `FELT` actually requires. */
export const felt = (x: bigint | number | string): string => num.toHex(x);

/** Re-exported so callers type their action arrays against the wallet's own type. */
export type { STRK20_ACTION };

export interface InvokeArgs {
  operation: AuctionOperation;
  auctionId: bigint;
  bidIndex?: number;
  claimCommitment?: bigint;
  upAnchor?: bigint;
  downAnchor?: bigint;
  claimSecret?: bigint;
  witnessDown?: bigint;
  /** A literal note id, or the wallet placeholder `${openNoteIds[0]}`. */
  noteId?: string;
}

/**
 * Calldata for `AuctionAnonymizer::privacy_invoke`, in declaration order. The order is
 * load-bearing: the pool deserializes it directly into the function's parameters.
 */
export function invokeCalldata(a: InvokeArgs): string[] {
  return [
    felt(a.operation),
    felt(a.auctionId),
    felt(a.bidIndex ?? 0),
    felt(a.claimCommitment ?? 0n),
    felt(a.upAnchor ?? 0n),
    felt(a.downAnchor ?? 0n),
    felt(a.claimSecret ?? 0n),
    felt(a.witnessDown ?? 0n),
    a.noteId ?? felt(0),
  ];
}

export interface BidActionArgs {
  helper: string;
  paymentToken: string;
  collateral: bigint;
  auctionId: bigint;
  claimCommitment: bigint;
  upAnchor: bigint;
  downAnchor: bigint;
}

/**
 * Place a bid: move the collateral out of the pool to the helper, then invoke it, in
 * one atomic pool transaction. A revert anywhere aborts the whole thing and no funds
 * move.
 *
 * There is no open note in this leg. The helper forwards the collateral into the
 * auction and returns an empty span, which is the protocol's way of saying "credit
 * nothing" — the funds are parked, not returned.
 */
export const placeBidActions = (a: BidActionArgs): STRK20_ACTION[] => [
  {
    type: "withdraw",
    token: felt(a.paymentToken),
    amount: felt(a.collateral),
    recipient: felt(a.helper),
  },
  {
    type: "invoke",
    contract: felt(a.helper),
    calldata: invokeCalldata({
      operation: AuctionOperation.PlaceBid,
      auctionId: a.auctionId,
      claimCommitment: a.claimCommitment,
      upAnchor: a.upAnchor,
      downAnchor: a.downAnchor,
    }),
  },
];

export interface ClaimActionArgs {
  helper: string;
  /** Payment token for a refund or surplus; lot token for the lot. */
  token: string;
  /** Who ends up holding the private note. */
  owner: string;
  auctionId: bigint;
  bidIndex: number;
  claimSecret: bigint;
  witnessDown?: bigint;
}

export type ClaimOperation =
  | AuctionOperation.ClaimRefund
  | AuctionOperation.RedeemForfeit
  | AuctionOperation.ClaimLot;

/**
 * Collect a refund, a winner's surplus, a forfeited escrow, or the lot — always into
 * an **open note**, so what comes back is private balance inside the pool rather than
 * a public transfer to an address.
 *
 * `${openNoteIds[0]}` names the note opened by the first action; the wallet
 * substitutes the real id during assembly.
 */
export const claimActions = (
  operation: ClaimOperation,
  a: ClaimActionArgs,
): STRK20_ACTION[] => [
  { type: "transfer", token: felt(a.token), amount: "OPEN", recipient: felt(a.owner) },
  {
    type: "invoke",
    contract: felt(a.helper),
    calldata: invokeCalldata({
      operation,
      auctionId: a.auctionId,
      bidIndex: a.bidIndex,
      claimSecret: a.claimSecret,
      witnessDown: a.witnessDown ?? 0n,
      noteId: "${openNoteIds[0]}",
    }),
  },
];

/**
 * The pool charges a flat fee per private operation, and wallet flows sponsor gas but
 * **not** that fee. Read it rather than hardcoding: it is governance-settable, and it
 * was 4 STRK on mainnet when the STRK20 agent skill was written. Subtract it before
 * pre-filling any MAX amount, or the operation fails after the user has signed.
 */
export async function poolFee(
  provider: {
    callContract: (c: {
      contractAddress: string;
      entrypoint: string;
      calldata?: string[];
    }) => Promise<string[]>;
  },
  poolAddress: string,
): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: poolAddress,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  return BigInt(res[0]!);
}

/**
 * What a bid actually costs a bidder up front: the uniform collateral plus one pool
 * fee. Surfacing both separately matters, because the collateral comes back and the
 * fee does not.
 */
export const bidCost = (collateral: bigint, fee: bigint) => ({
  collateral,
  fee,
  total: collateral + fee,
});
