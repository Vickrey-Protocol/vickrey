/**
 * §5 of the Sepolia definition of done: `abandon`, on chain, both sides of the boundary.
 *
 *   AUCTION=0x… NETWORK=sepolia node scripts/verify-abandon.mjs
 *
 * Unit tests already cover this. They run against a simulated clock, and `abandon` is
 * gated on `sealed_at_time + dispute_window` compared to a real block timestamp — which
 * is exactly the kind of thing that passes in a test and behaves differently against a
 * sequencer. This runs it for real: seal, refuse early, wait out the grace, abandon,
 * and check every bidder is made whole.
 *
 * It is one of the three tests that can invalidate the freeze, so it runs before
 * anything is declared on mainnet.
 */
import { Account, CallData, RpcProvider, num, shortString } from "starknet";
import { readFileSync } from "node:fs";
import { createBid } from "../client/src/bid.ts";
import { AuctionKind } from "../client/src/types.ts";

const NETWORK = process.env.NETWORK ?? "sepolia";
const RPC = process.env.STARKNET_RPC ?? {
  sepolia: "https://api.cartridge.gg/x/starknet/sepolia",
  mainnet: "https://api.cartridge.gg/x/starknet/mainnet",
}[NETWORK];
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AUCTION = process.env.AUCTION;
if (!AUCTION) throw new Error("set AUCTION to the deployed auction address");

const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const me = ks[NETWORK === "mainnet" ? "alpha-mainnet" : "alpha-sepolia"][process.env.ACCOUNT ?? "account_ready"];
const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });

const E15 = 1_000_000_000_000_000n;
const NUM_LEVELS = 8;
const WINDOW = 90;                       // the grace period, and the dispute window
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const send = async (label, calls) => {
  const { transaction_hash } = await account.execute(calls);
  const r = await provider.waitForTransaction(transaction_hash, { retryInterval: 3000 });
  const ok = (r.execution_status ?? r.statusReceipt) !== "REVERTED";
  console.log(`    ${label.padEnd(26)} ${transaction_hash} ${ok ? "OK" : "REVERTED"}`);
  if (!ok) throw new Error(`${label} reverted`);
  return transaction_hash;
};
const read = (entrypoint, calldata = []) =>
  provider.callContract({ contractAddress: AUCTION, entrypoint, calldata });

/** Expects a revert, and checks the reason rather than accepting any failure. */
const expectRefusal = async (label, calls, wanted) => {
  try {
    await account.execute(calls);
    record(label, false, `it succeeded — ${wanted} was not enforced`);
    return false;
  } catch (e) {
    const msg = String(e?.message ?? e);
    const hit = msg.includes(wanted);
    record(label, hit, hit ? `refused with ${wanted}` : `refused, but with: ${msg.slice(-120)}`);
    return hit;
  }
};

console.log(`\nverify abandon · ${NETWORK} · auction ${AUCTION}\n`);

// ── set up an auction with a short, known grace ──────────────────────────────
const terms = { auctionId: 0n, kind: AuctionKind.Vickrey, reservePrice: E15, tick: E15, numLevels: NUM_LEVELS };
const CAP = terms.reservePrice + terms.tick * BigInt(NUM_LEVELS - 1);
const LOT = E15, BOND = E15;
const DEADLINE = Math.floor(Date.now() / 1000) + 100;

await send("approve + create_auction", [
  { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(LOT + BOND), "0x0"]) },
  { contractAddress: AUCTION, entrypoint: "create_auction", calldata: CallData.compile([
      me.address, me.address, STRK, STRK, num.toHex(LOT), "0x1",
      num.toHex(terms.reservePrice), num.toHex(terms.tick), num.toHex(NUM_LEVELS),
      num.toHex(DEADLINE), num.toHex(WINDOW), num.toHex(BOND),
      shortString.encodeShortString("ABANDON TEST")]) },
]);
const id = BigInt((await read("auction_count"))[0]) - 1n;
terms.auctionId = id;
console.log(`    auction id ${id}\n`);

const bids = [];
for (const [i, level] of [5, 2].entries()) {
  const b = { ...createBid(terms, level), index: i };
  bids.push(b);
  await send(`approve + place_bid #${i}`, [
    { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(CAP), "0x0"]) },
    { contractAddress: AUCTION, entrypoint: "place_bid",
      calldata: CallData.compile([num.toHex(id), num.toHex(b.claimCommitment), num.toHex(b.upAnchor), num.toHex(b.downAnchor)]) },
  ]);
}

// ── an Open auction is not abandonable ───────────────────────────────────────
await expectRefusal("an Open auction cannot be abandoned",
  [{ contractAddress: AUCTION, entrypoint: "abandon", calldata: [num.toHex(id)] }],
  "AUCTION_NOT_SEALED");

console.log(`\n    waiting for the bid deadline…`);
while (Math.floor(Date.now() / 1000) < DEADLINE + 5) await new Promise((r) => setTimeout(r, 5000));
await send("seal", [{ contractAddress: AUCTION, entrypoint: "seal", calldata: [num.toHex(id)] }]);

const sealedAt = Number(BigInt((await read("get_state", [num.toHex(id)]))[4]));
console.log(`    sealed_at_time ${sealedAt}, grace ends ${sealedAt + WINDOW}\n`);

// ── inside the grace: refused ────────────────────────────────────────────────
await expectRefusal("abandon inside the grace period",
  [{ contractAddress: AUCTION, entrypoint: "abandon", calldata: [num.toHex(id)] }],
  "SETTLE_GRACE_OPEN");

// ── after the grace: allowed ─────────────────────────────────────────────────
console.log(`\n    waiting out the grace…`);
while (Math.floor(Date.now() / 1000) < sealedAt + WINDOW + 5) await new Promise((r) => setTimeout(r, 5000));

/* Measure the **auction contract's** balance across the abandon call, not our own.
   Gas is paid in STRK out of the same account that receives the lot and bond, so a
   before/after on our own balance nets negative and reports a false failure: the first
   run of this script charged 0.34 STRK in fees to return 0.002 of lot and bond. The
   contract's balance moves only because of the auction. */
const heldBefore = BigInt((await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [AUCTION] }))[0]);
await send("abandon", [{ contractAddress: AUCTION, entrypoint: "abandon", calldata: [num.toHex(id)] }]);
const heldAfter = BigInt((await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [AUCTION] }))[0]);
const status = Number(BigInt((await read("get_state", [num.toHex(id)]))[0]));
record("abandon cancels the auction", status === 5, `status = ${status} (5 = Cancelled)`);

// ── everyone is made whole ───────────────────────────────────────────────────
/* Read what actually came back rather than asserting the arithmetic we expect: each
   bidder should get their escrow plus an equal share of the forfeited bond. */
const share = BOND / BigInt(bids.length);
let allRight = true;
for (const b of bids) {
  const before = BigInt((await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [AUCTION] }))[0]);
  await send(`claim_refund #${b.index}`, [{ contractAddress: AUCTION, entrypoint: "claim_refund",
    calldata: CallData.compile([num.toHex(id), num.toHex(b.index), num.toHex(b.claimSecret), me.address]) }]);
  const after = BigInt((await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [AUCTION] }))[0]);
  const paid = before - after;
  if (paid !== CAP + share) allRight = false;
  console.log(`      paid ${paid} wei  (cap ${CAP} + bond share ${share})`);
}
record("each bidder gets their escrow plus a share of the forfeited bond", allRight,
  `expected ${CAP + share} wei each across ${bids.length} bids`);

const released = heldBefore - heldAfter;
/* Only the lot leaves at abandon. The bond stays behind and is paid to the bidders
   through claim_refund — returning it to the seller was the defect this closed. */
record("only the lot is released at abandon; the bond stays for the bidders",
  released === LOT,
  `contract released ${released} wei (lot ${LOT}); bond ${BOND} retained for bidders`);

// ── a cancelled auction cannot be abandoned again ────────────────────────────
await expectRefusal("abandon is not repeatable",
  [{ contractAddress: AUCTION, entrypoint: "abandon", calldata: [num.toHex(id)] }],
  "AUCTION_NOT_SEALED");

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(`\n  §5 FAILS — the freeze does not hold.`); process.exit(1); }
console.log(`  §5 verified on ${NETWORK}.`);
