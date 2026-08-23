/**
 * Pins the pool-facing wire format.
 *
 * The FELT pattern is the one from the Wallet API 0.10.3 types:
 * `^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$` — prefixed hex, no leading zeros. A
 * decimal amount here is a transaction the wallet refuses after the user has signed,
 * so it is worth a test rather than a comment.
 */
import { describe, expect, it } from "vitest";
import {
  bidCost,
  claimActions,
  felt,
  invokeCalldata,
  placeBidActions,
} from "../src/strk20";
import { AuctionOperation } from "../src/types";

const FELT_RE = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

const HELPER = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OWNER = "0x0123";

describe("felt encoding", () => {
  it("emits prefixed hex with no leading zeros", () => {
    for (const v of [0n, 1n, 250n, 4096n, 2n ** 200n]) {
      expect(felt(v)).toMatch(FELT_RE);
    }
    expect(felt(0n)).toBe("0x0");
    expect(felt(2748n)).toBe("0xabc");
  });

  it("normalizes a zero-padded address", () => {
    // Padded and unpadded hex name the same address, but only one matches FELT.
    expect(felt(OWNER)).toBe("0x123");
    expect(felt(OWNER)).toMatch(FELT_RE);
  });
});

describe("privacy_invoke calldata", () => {
  it("is nine felts in the helper's declaration order", () => {
    const cd = invokeCalldata({
      operation: AuctionOperation.PlaceBid,
      auctionId: 42n,
      claimCommitment: 111n,
      upAnchor: 222n,
      downAnchor: 333n,
    });
    expect(cd).toHaveLength(9);
    expect(cd).toEqual([
      "0x0", // operation: PlaceBid
      "0x2a", // auction_id
      "0x0", // bid_index
      "0x6f", // claim_commitment
      "0xde", // up_anchor
      "0x14d", // down_anchor
      "0x0", // claim_secret
      "0x0", // witness_down
      "0x0", // note_id
    ]);
  });

  it("passes the note placeholder through untouched", () => {
    const cd = invokeCalldata({
      operation: AuctionOperation.ClaimRefund,
      auctionId: 1n,
      noteId: "${openNoteIds[0]}",
    });
    expect(cd[8]).toBe("${openNoteIds[0]}");
  });
});

describe("bid actions", () => {
  const actions = placeBidActions({
    helper: HELPER,
    paymentToken: TOKEN,
    collateral: 250n,
    auctionId: 7n,
    claimCommitment: 1n,
    upAnchor: 2n,
    downAnchor: 3n,
  });

  it("withdraws the collateral to the helper, then invokes it", () => {
    expect(actions.map((a) => a.type)).toEqual(["withdraw", "invoke"]);
  });

  it("encodes the amount as a felt, not a decimal string", () => {
    const withdraw = actions[0]!;
    if (withdraw.type !== "withdraw") throw new Error("expected a withdraw");
    expect(withdraw.amount).toBe("0xfa");
    expect(withdraw.amount).toMatch(FELT_RE);
    expect(withdraw.recipient).toBe(felt(HELPER));
  });

  it("opens no note — the collateral is parked, not credited back", () => {
    expect(actions.some((a) => a.type === "transfer")).toBe(false);
  });
});

describe("claim actions", () => {
  it("opens a note first, then invokes with the placeholder", () => {
    const actions = claimActions(AuctionOperation.ClaimRefund, {
      helper: HELPER,
      token: TOKEN,
      owner: OWNER,
      auctionId: 7n,
      bidIndex: 2,
      claimSecret: 99n,
    });

    const open = actions[0]!;
    if (open.type !== "transfer") throw new Error("expected a transfer");
    expect(open.amount).toBe("OPEN");
    expect(open.recipient).toBe(felt(OWNER));

    const invoke = actions[1]!;
    if (invoke.type !== "invoke") throw new Error("expected an invoke");
    expect(invoke.calldata[8]).toBe("${openNoteIds[0]}");
    expect(invoke.calldata[0]).toBe("0x1"); // ClaimRefund
    expect(invoke.calldata[2]).toBe("0x2"); // bid_index
  });

  it("carries the loser-side witness only when redeeming a forfeit", () => {
    const redeem = claimActions(AuctionOperation.RedeemForfeit, {
      helper: HELPER,
      token: TOKEN,
      owner: OWNER,
      auctionId: 7n,
      bidIndex: 0,
      claimSecret: 5n,
      witnessDown: 1234n,
    });
    const invoke = redeem[1]!;
    if (invoke.type !== "invoke") throw new Error("expected an invoke");
    expect(invoke.calldata[7]).toBe("0x4d2");
  });

  it("claims the lot in the lot token, not the payment token", () => {
    const lot = claimActions(AuctionOperation.ClaimLot, {
      helper: HELPER,
      token: "0x999",
      owner: OWNER,
      auctionId: 7n,
      bidIndex: 0,
      claimSecret: 5n,
    });
    const open = lot[0]!;
    if (open.type !== "transfer") throw new Error("expected a transfer");
    expect(open.token).toBe("0x999");
  });
});

describe("cost", () => {
  it("keeps the refundable collateral separate from the fee that is not", () => {
    expect(bidCost(250n, 4n)).toEqual({ collateral: 250n, fee: 4n, total: 254n });
  });
});
