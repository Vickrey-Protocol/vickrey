/**
 * The v2 calldata is a contract with the Cairo signatures, and getting a felt out of
 * order fails only on chain. These pin the shapes, and the two numbers the client and
 * the contract must compute identically.
 */
import { describe, expect, it } from "vitest";
import { AuctionKind } from "@vickrey/client";
import {
  LotKind, OperationV2, ScreeningPolicy, byteArrayFelts, collectActionsV2, collectNotes,
  createCalldata, createCalls, invokeCalldataV2, privateCollectVerdict, termsHash,
  type CreateParams,
} from "@/lib/v2";

const big = (xs: string[]) => xs.map((x) => BigInt(x));

const base: CreateParams = {
  auction: "0xa", seller: "0x51", auctioneer: "0x52", paymentToken: "0x5", lotToken: "0x6",
  lotAmount: 100n, kind: AuctionKind.Vickrey, reservePrice: 3n, tick: 3n, numLevels: 8,
  bidDeadline: 1000, disputeWindow: 60, auctioneerBond: 3n, termsHash: 7n,
  lotKind: LotKind.Erc20, lotTokenId: 0n, revealKey: { x: 0x11n, y: 0x12n },
  revealWindow: 50, deliveryWindow: 0, sellerBond: 0n, terms: "",
};

describe("create_auction calldata", () => {
  it("is AuctionConfig in v1 order, then AuctionExtras, then the terms ByteArray", () => {
    const cd = big(createCalldata(base));
    expect(cd.slice(0, 13)).toEqual([0x51n, 0x52n, 5n, 6n, 100n, 1n, 3n, 3n, 8n, 1000n, 60n, 3n, 7n]);
    // lot_kind, token_id (u256: low, high), key x, key y, reveal, delivery, seller bond
    expect(cd.slice(13, 21)).toEqual([0n, 0n, 0n, 0x11n, 0x12n, 50n, 0n, 0n]);
    // empty ByteArray: no full words, pending 0, length 0
    expect(cd.slice(21)).toEqual([0n, 0n, 0n]);
  });

  it("splits a token id into u256 halves", () => {
    const cd = big(createCalldata({ ...base, lotKind: LotKind.Erc721, lotTokenId: (5n << 128n) + 9n }));
    expect(cd.slice(13, 16)).toEqual([1n, 9n, 5n]);
  });
});

describe("the listing approves exactly what create_auction pulls", () => {
  const approvals = (p: CreateParams) => createCalls(p)
    .filter((c) => c.entrypoint === "approve")
    .map((c) => ({ token: c.contractAddress, args: big(c.calldata as string[]) }));

  it("ERC-20 lot in its own token: the lot, then bond in the payment token", () => {
    expect(approvals(base)).toEqual([
      { token: "0x6", args: [0xan, 100n, 0n] }, { token: "0x5", args: [0xan, 3n, 0n] },
    ]);
  });

  it("ERC-20 lot in the payment token: one approval for lot plus bond", () => {
    expect(approvals({ ...base, lotToken: "0x5" })).toEqual([{ token: "0x5", args: [0xan, 103n, 0n] }]);
  });

  it("NFT: approves that one token id, and the bond", () => {
    expect(approvals({ ...base, lotKind: LotKind.Erc721, lotTokenId: 42n, lotAmount: 1n })).toEqual([
      { token: "0x6", args: [0xan, 42n, 0n] }, { token: "0x5", args: [0xan, 3n, 0n] },
    ]);
  });

  it("off-chain: auctioneer bond plus seller bond, no lot", () => {
    expect(approvals({ ...base, lotKind: LotKind.OffChain, lotToken: "0x0", lotAmount: 0n, sellerBond: 4n }))
      .toEqual([{ token: "0x5", args: [0xan, 7n, 0n] }]);
  });

  it("ends with the listing itself", () => {
    expect(createCalls(base).at(-1)!.entrypoint).toBe("create_auction");
  });
});

describe("terms", () => {
  it("hashes the text exactly as the contract does", () => {
    // From `snforge test terms_hash_vector`, which asserts the same number.
    expect(termsHash("What it is: A signed first edition\nHow it's delivered: Tracked post"))
      .toBe(2787443723799347230240266750640810916947376215087829394704248588849502721177n);
  });

  it("serializes a ByteArray as full words, pending word, pending length", () => {
    const felts = byteArrayFelts("a".repeat(40));
    expect(BigInt(felts[0]!)).toBe(1n);
    expect(BigInt(felts.at(-1)!)).toBe(9n);
  });
});

describe("collect notes match what the anonymizer returns", () => {
  const o = { paymentToken: "0x5", paymentOut: 10n, isWinner: true, lotKind: LotKind.Erc20,
    lotToken: "0x6", lotAmount: 100n };

  it("a winner with a lot in its own token: two notes, payment first", () => {
    expect(collectNotes(o)).toEqual(["0x5", "0x6"]);
  });
  it("a lot in the payment token: one note", () => {
    expect(collectNotes({ ...o, lotToken: "0x5" })).toEqual(["0x5"]);
  });
  it("a zero surplus opens no payment note", () => {
    expect(collectNotes({ ...o, paymentOut: 0n })).toEqual(["0x6"]);
  });
  it("an NFT winner: only the surplus", () => {
    expect(collectNotes({ ...o, lotKind: LotKind.Erc721 })).toEqual(["0x5"]);
  });
  it("a loser: only the refund", () => {
    expect(collectNotes({ ...o, isWinner: false })).toEqual(["0x5"]);
  });
});

describe("the private collect transaction", () => {
  it("opens one note per output and points each id at the right one", () => {
    const actions = collectActionsV2({ helper: "0xab", owner: "0x0e", auctionId: 3n, bidIndex: 2,
      claimSecret: 9n, notes: ["0x5", "0x6"], paymentToken: "0x5" });
    expect(actions.map((a) => a.type)).toEqual(["transfer", "transfer", "invoke"]);
    const cd = (actions[2] as { calldata: string[] }).calldata;
    expect(cd[0]).toBe("0x1"); // Collect
    expect(cd[8]).toBe("${openNoteIds[0]}");
    expect(cd[9]).toBe("${openNoteIds[1]}");
  });

  it("has the v2 anonymizer's eleven parameters in order", () => {
    const cd = invokeCalldataV2({ operation: OperationV2.RedeemForfeit, auctionId: 1n,
      bidIndex: 2, claimSecret: 3n, witnessDown: 4n, noteId: "0x9", lotRecipient: "0x7" });
    expect(cd).toEqual(["0x2", "0x1", "0x2", "0x0", "0x0", "0x0", "0x3", "0x4", "0x9", "0x0", "0x7"]);
  });
});

describe("whether a private collect may be sent", () => {
  it("only when the pool says Exempt", () => {
    expect(privateCollectVerdict({ result: [String(ScreeningPolicy.Exempt)] }).verdict).toBe("available");
    expect(privateCollectVerdict({ result: ["0x0"] }).verdict).toBe("unavailable");
    expect(privateCollectVerdict({ result: ["0x2"] }).verdict).toBe("unavailable");
  });

  it("a failed read is unknown, never a guess", () => {
    expect(privateCollectVerdict({ error: "timeout" })).toEqual({ verdict: "unknown", why: "timeout" });
    expect(privateCollectVerdict({ result: [] }).verdict).toBe("unknown");
    expect(privateCollectVerdict({ result: ["0x9"] }).verdict).toBe("unknown");
  });
});

describe("ByteArray round trip", () => {
  it("decodes what it encodes, multi-line and non-ASCII included", async () => {
    const { decodeByteArray } = await import("@/lib/v2");
    for (const t of ["", "short", "x".repeat(31), "line one\nline two — ✓ " + "y".repeat(70)]) {
      expect(decodeByteArray(byteArrayFelts(t))).toBe(t);
    }
  });
});
