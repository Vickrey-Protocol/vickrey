/**
 * The winner's collection, as one transaction.
 *
 * `claim_lot` and `claim_refund` are each authorised by the claim secret alone, and the
 * secret travels in calldata. The winner holds two things — the lot and the surplus — so
 * the first claim to land published the key to the second: anyone reading the chain
 * could then call the other one with their own address as recipient. The screen made
 * this the normal path, with "1 · Claim the lot" and "2 · Claim your surplus" as two
 * buttons and two transactions.
 *
 * Collected together in one multicall, the secret is never on chain while anything it
 * unlocks is still uncollected. If only one of the two remains, the secret is already
 * public and the remaining one is claimed alone — and should be, at once.
 *
 * This is the public rail only. The private rail is a separate pool transaction per
 * claim, which would reopen the gap between them.
 */
import { CallData, num, type Call } from "starknet";

export interface WinnerCollect {
  auctionAddress: string;
  auctionId: bigint;
  index: number;
  claimSecret: bigint;
  recipient: string;
  lotClaimed: boolean;
  refundClaimed: boolean;
}

export function winnerCollectCalls(w: WinnerCollect): Call[] {
  const id = num.toHex(w.auctionId);
  const secret = num.toHex(w.claimSecret);
  const calls: Call[] = [];
  if (!w.lotClaimed) {
    calls.push({ contractAddress: w.auctionAddress, entrypoint: "claim_lot",
      calldata: CallData.compile([id, secret, w.recipient]) });
  }
  if (!w.refundClaimed) {
    calls.push({ contractAddress: w.auctionAddress, entrypoint: "claim_refund",
      calldata: CallData.compile([id, num.toHex(w.index), secret, w.recipient]) });
  }
  return calls;
}

/**
 * True when exactly one of the two has been collected: the secret is already on chain
 * and the other half can be taken by anyone who looks.
 */
export const halfCollected = (lotClaimed: boolean, refundClaimed: boolean) =>
  lotClaimed !== refundClaimed;
