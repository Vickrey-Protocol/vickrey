/**
 * §6a: `Routed` and `BidPlaced` in one on-chain transaction.
 *
 *   AUCTION=0x… NETWORK=sepolia node scripts/verify-events.mjs
 *
 * The submission rule requires each mainnet hash to touch the pool **and** carry an
 * event from a contract we listed. That is two contracts emitting inside one
 * transaction, and until it has happened on a real chain it is an expectation.
 *
 * This does not need a wallet, a shielded balance, or Xverse. `MockPrivacyPool` drives
 * `privacy_invoke` exactly as the real pool does — withdraw to the helper, invoke it,
 * pull what it approved — so the contracts under test are the real `AuctionAnonymizer`
 * and the real `SealedBidAuction`. What it does not prove is that the *real* pool
 * accepts our encoding; `verify-pool-shapes.mjs` covers that separately, read-only,
 * against live mainnet.
 *
 * Splitting it this way is the point: the half that can force a Cairo change is the
 * half that does not depend on a wallet, so the freeze never waits on one.
 */
import { Account, CallData, RpcProvider, hash, num, shortString } from "starknet";
import { readFileSync } from "node:fs";
import { createBid } from "../client/src/bid.ts";
import { AuctionKind } from "../client/src/types.ts";

const NETWORK = process.env.NETWORK ?? "sepolia";
/* Printed before anything else. A script that reads chain state without naming
   its chain produces answers that cannot be checked. */
console.log(`  network    ${NETWORK}${process.env.NETWORK ? " (NETWORK env)" : " (default)"}`);
const RPC = process.env.STARKNET_RPC ?? {
  sepolia: "https://api.cartridge.gg/x/starknet/sepolia",
  mainnet: "https://api.cartridge.gg/x/starknet/mainnet",
}[NETWORK];
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AUCTION = process.env.AUCTION;
const POOL = process.env.MOCK_POOL;      // deployed by scripts/deploy-mock-pool.sh
const HELPER = process.env.HELPER;       // an anonymizer pointed at MOCK_POOL
if (!AUCTION || !POOL || !HELPER) {
  throw new Error("set AUCTION, MOCK_POOL and HELPER (see scripts/deploy-mock-pool.sh)");
}

const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const me = ks[NETWORK === "mainnet" ? "alpha-mainnet" : "alpha-sepolia"][process.env.ACCOUNT ?? "account_ready"];
const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });

const E15 = 1_000_000_000_000_000n;
const NUM_LEVELS = 8;
const results = [];
const record = (name, pass, detail) => {
  results.push({ pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const send = async (label, calls) => {
  const { transaction_hash } = await account.execute(calls);
  const r = await provider.waitForTransaction(transaction_hash, { retryInterval: 3000 });
  const ok = (r.execution_status ?? r.statusReceipt) !== "REVERTED";
  console.log(`    ${label.padEnd(28)} ${transaction_hash} ${ok ? "OK" : "REVERTED"}`);
  if (!ok) throw new Error(`${label} reverted`);
  return transaction_hash;
};
const read = (entrypoint, calldata = []) =>
  provider.callContract({ contractAddress: AUCTION, entrypoint, calldata });

console.log(`\nverify events · ${NETWORK}\n  auction ${AUCTION}\n  pool    ${POOL}\n  helper  ${HELPER}\n`);

// ── an auction to bid into ───────────────────────────────────────────────────
const terms = { auctionId: 0n, kind: AuctionKind.Vickrey, reservePrice: E15, tick: E15, numLevels: NUM_LEVELS };
const CAP = terms.reservePrice + terms.tick * BigInt(NUM_LEVELS - 1);
const DEADLINE = Math.floor(Date.now() / 1000) + 600;

await send("approve + create_auction", [
  { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(E15 * 2n), "0x0"]) },
  { contractAddress: AUCTION, entrypoint: "create_auction", calldata: CallData.compile([
      me.address, me.address, STRK, STRK, num.toHex(E15), "0x1",
      num.toHex(terms.reservePrice), num.toHex(terms.tick), num.toHex(NUM_LEVELS),
      num.toHex(DEADLINE), num.toHex(120), num.toHex(E15),
      shortString.encodeShortString("EVENT TEST")]) },
]);
const id = BigInt((await read("auction_count"))[0]) - 1n;
console.log(`    auction id ${id}\n`);

// ── fund the mock pool, then let it drive the sandwich ───────────────────────
const bid = createBid({ ...terms, auctionId: id }, 4);
const txHash = await send("pool drives place_bid", [
  { contractAddress: STRK, entrypoint: "transfer", calldata: CallData.compile([POOL, num.toHex(CAP), "0x0"]) },
  { contractAddress: POOL, entrypoint: "drive_bid", calldata: CallData.compile([
      HELPER, STRK, num.toHex(CAP), num.toHex(id),
      num.toHex(bid.claimCommitment), num.toHex(bid.upAnchor), num.toHex(bid.downAnchor)]) },
]);

// ── the assertion this whole script exists for ───────────────────────────────
const receipt = await provider.getTransactionReceipt(txHash);
const events = receipt.events ?? [];
const norm = (a) => BigInt(a);
const ROUTED = hash.getSelectorFromName("Routed");
const BID_PLACED = hash.getSelectorFromName("BidPlaced");

const fromHelper = events.filter((e) => norm(e.from_address) === norm(HELPER));
const fromAuction = events.filter((e) => norm(e.from_address) === norm(AUCTION));
const routed = fromHelper.find((e) => e.keys.some((k) => norm(k) === norm(ROUTED)));
const placed = fromAuction.find((e) => e.keys.some((k) => norm(k) === norm(BID_PLACED)));

console.log();
record("Routed emitted by the anonymizer", !!routed,
  routed ? `keys ${routed.keys.length}, data ${routed.data.length}` : `helper emitted ${fromHelper.length} events`);
record("BidPlaced emitted by the auction", !!placed,
  placed ? `keys ${placed.keys.length}` : `auction emitted ${fromAuction.length} events`);
record("both in the same transaction", !!routed && !!placed, txHash);

// The privacy note the event must never carry.
if (routed) {
  const leaked = [...routed.keys, ...routed.data].some((v) => norm(v) === norm(bid.claimCommitment));
  record("Routed carries no bid-identifying value", !leaked,
    leaked ? "the claim commitment appeared in the event" : "auction id and operation only");
}

const bidCount = Number(BigInt((await read("get_state", [num.toHex(id)]))[1]));
record("the bid actually landed", bidCount === 1, `bid_count = ${bidCount}`);

const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed`);
if (failed) { console.log(`\n  §6a FAILS — the freeze does not hold.`); process.exit(1); }
console.log(`  §6a verified on ${NETWORK}. Transaction: ${txHash}`);
