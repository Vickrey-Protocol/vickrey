/**
 * Runs a complete auction on a live network, driven by the real client library:
 * list, bid, seal, settle, finalize, claim.
 *
 * This exercises the **auction layer** with direct contract calls. It does not go
 * through the STRK20 pool, so it needs no privacy wallet and no proving - which is
 * exactly why it can run unattended. The pool leg is a separate path and needs a
 * wallet; see docs/telegram-questions.md.
 *
 * Network comes from the environment. Nothing here assumes Sepolia.
 *
 *   AUCTION=0x... NETWORK=sepolia node scripts/live-auction.mjs
 *   AUCTION=0x... NETWORK=mainnet ACCOUNT=my-account node scripts/live-auction.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Account, CallData, RpcProvider, num, shortString } from "starknet";
import { createBid, revealFor } from "../client/src/bid.ts";
import { planSettlement, verifyPlan } from "../client/src/settle.ts";
import { AuctionKind } from "../client/src/types.ts";

const NETWORK = process.env.NETWORK ?? "sepolia";
const RPC = process.env.STARKNET_RPC ?? {
  sepolia: "https://api.cartridge.gg/x/starknet/sepolia",
  mainnet: "https://api.cartridge.gg/x/starknet/mainnet",
}[NETWORK];
if (!RPC) throw new Error(`no RPC for network ${NETWORK}; set STARKNET_RPC`);
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AUCTION = process.env.AUCTION;

const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const KEYCHAIN = NETWORK === "mainnet" ? "alpha-mainnet" : "alpha-sepolia";
const ACCOUNT = process.env.ACCOUNT ?? "account_ready";
const me = ks[KEYCHAIN]?.[ACCOUNT];
if (!me) throw new Error(`no account "${ACCOUNT}" under "${KEYCHAIN}" in the sncast keystore`);

const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });

const log = (...a) => console.log(...a);
const E15 = 1_000_000_000_000_000n;

async function send(label, calls) {
  const { transaction_hash } = await account.execute(calls);
  process.stdout.write(`  ${label.padEnd(28)} ${transaction_hash} `);
  const r = await provider.waitForTransaction(transaction_hash, { retryInterval: 3000 });
  const ok = (r.execution_status ?? r.statusReceipt) !== "REVERTED";
  console.log(ok ? "OK" : "REVERTED");
  if (!ok) { console.log(JSON.stringify(r).slice(0, 600)); process.exit(1); }
  return transaction_hash;
}
const read = async (entrypoint, calldata = []) =>
  provider.callContract({ contractAddress: AUCTION, entrypoint, calldata });

const NUM_LEVELS = 8;
const terms = {
  auctionId: 0n, kind: AuctionKind.Vickrey,
  reservePrice: E15, tick: E15, numLevels: NUM_LEVELS,
};
const CAP = terms.reservePrice + terms.tick * BigInt(NUM_LEVELS - 1); // 8e15
const LOT = E15, BOND = E15;
const hashes = {};

const now = Math.floor(Date.now() / 1000);
const DEADLINE = now + 200;
const WINDOW = 60;

log(`\nnetwork  ${NETWORK}`);
log(`auction  ${AUCTION}`);
log(`account  ${me.address}`);
log(`cap      ${CAP} wei  ·  deadline +200s  ·  dispute window ${WINDOW}s\n`);

// ── 1. list ────────────────────────────────────────────────────────────
const config = CallData.compile([
  me.address, me.address, STRK, STRK,
  num.toHex(LOT), "0x1",                       // lot_amount, kind = Vickrey
  num.toHex(terms.reservePrice), num.toHex(terms.tick),
  num.toHex(NUM_LEVELS), num.toHex(DEADLINE), num.toHex(WINDOW),
  num.toHex(BOND), shortString.encodeShortString("ONE RARE THING"),
]);
hashes.create = await send("approve + create_auction", [
  { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(LOT + BOND), "0x0"]) },
  { contractAddress: AUCTION, entrypoint: "create_auction", calldata: config },
]);
const id = BigInt((await read("auction_count"))[0]) - 1n;
terms.auctionId = id;
log(`  auction id ${id}\n`);

// ── 2. bid ─────────────────────────────────────────────────────────────
const LEVELS = [6, 4, 1];                      // Vickrey clears at 4
const bids = [];
for (const [i, level] of LEVELS.entries()) {
  const b = { ...createBid(terms, level), index: i };
  bids.push(b);
  hashes[`bid${i}`] = await send(`approve + place_bid #${i}`, [
    { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(CAP), "0x0"]) },
    { contractAddress: AUCTION, entrypoint: "place_bid",
      calldata: CallData.compile([num.toHex(id), num.toHex(b.claimCommitment), num.toHex(b.upAnchor), num.toHex(b.downAnchor)]) },
  ]);
}
writeFileSync("bids.json", JSON.stringify(bids, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
log(`\n  ${bids.length} bids placed. Chain holds two hashes each and nothing else.\n`);

// ── 3. seal ────────────────────────────────────────────────────────────
log(`  waiting for the bid deadline…`);
while (Math.floor(Date.now() / 1000) < DEADLINE + 5) await new Promise((r) => setTimeout(r, 5000));
hashes.seal = await send("seal", [{ contractAddress: AUCTION, entrypoint: "seal", calldata: [num.toHex(id)] }]);

// ── 4. settle ──────────────────────────────────────────────────────────
const publics = bids.map(({ index, claimCommitment, upAnchor, downAnchor }) => ({ index, claimCommitment, upAnchor, downAnchor }));
const plan = planSettlement(terms, publics, bids.map(revealFor));
const problems = verifyPlan(terms, publics, plan);
log(`\n  plan: winner #${plan.winnerIndex}, clearing level ${plan.clearingLevel} = ${plan.clearingPrice} wei`);
log(`  local verify: ${problems.length ? problems.join("; ") : "all witnesses check out"}`);
if (problems.length) process.exit(1);

const settleCd = [num.toHex(id), num.toHex(plan.clearingLevel), num.toHex(plan.winnerIndex), num.toHex(plan.proofs.length)];
for (const p of plan.proofs) settleCd.push(num.toHex(p.kind), num.toHex(p.witnessUp), num.toHex(p.witnessDown));
hashes.settle = await send("settle", [{ contractAddress: AUCTION, entrypoint: "settle", calldata: settleCd }]);

const st = await read("get_state", [num.toHex(id)]);
log(`  on-chain clearing level: ${BigInt(st[5])}   winner index: ${BigInt(st[6])}\n`);

// ── 5. finalize + claim ────────────────────────────────────────────────
log(`  waiting for the dispute window…`);
const disputeEnd = Number(BigInt(st[8]));
while (Math.floor(Date.now() / 1000) < disputeEnd + 5) await new Promise((r) => setTimeout(r, 5000));
hashes.finalize = await send("finalize", [{ contractAddress: AUCTION, entrypoint: "finalize", calldata: [num.toHex(id)] }]);

const winner = bids[plan.winnerIndex];
hashes.claimLot = await send("claim_lot (winner)", [{ contractAddress: AUCTION, entrypoint: "claim_lot",
  calldata: CallData.compile([num.toHex(id), num.toHex(winner.claimSecret), me.address]) }]);
const loser = bids.find((b) => b.index !== plan.winnerIndex);
hashes.claimRefund = await send("claim_refund (loser)", [{ contractAddress: AUCTION, entrypoint: "claim_refund",
  calldata: CallData.compile([num.toHex(id), num.toHex(loser.index), num.toHex(loser.claimSecret), me.address]) }]);

writeFileSync("hashes.json", JSON.stringify({ auction: AUCTION, id: id.toString(), ...hashes }, null, 2));
log(`\n  DONE. Clearing price ${plan.clearingPrice} wei, and no bid was ever opened.`);
log(`  hashes written to hashes.json`);
