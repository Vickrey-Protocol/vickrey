/**
 * Read-only checks that run before a deploy spends anything.
 *
 * The order matters. Every check here is a fetch, not a transaction, so the whole
 * thing is free — and it runs before `scarb build` and `snforge test`, because
 * discovering you are on the wrong chain or short of STRK after a four-minute test
 * run is a worse way to find out.
 *
 * The balance check exists because a Sepolia rehearsal died at the declare with
 * "Resources bounds ... exceed balance". That failure arrives *after* sncast has
 * built, estimated, signed and submitted, and it reads like a node problem rather
 * than an empty wallet. On mainnet it would be the same message with real money and
 * a half-finished deployment behind it.
 *
 *   node scripts/lib/preflight.mjs <rpc> <pool> <poolClass> <chainId> <account> <phase>
 *
 * phase is `deploy` (declares + deploys) or `full` (adds the auction lifecycle).
 */
import { readFileSync } from "node:fs";
import { hash } from "starknet";

const [, , rpc, pool, poolClass, chainId, account, phase = "deploy", skipCsv = ""] =
  process.argv;
/* Steps already done — an already-declared class costs nothing to re-run past, and
   demanding its fee anyway would block a resumed deploy that has the money it
   actually needs. */
const skip = new Set(skipCsv.split(",").filter(Boolean));

const PROFILE = JSON.parse(
  readFileSync(new URL("../gas-profile.json", import.meta.url), "utf8"),
);
/* Same address on both networks — STRK is the fee token and the thing we hold. */
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const rpcCall = async (method, params) => {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
};

const fail = (msg) => {
  console.error(`\n  REFUSING TO DEPLOY\n  ${msg}\n`);
  process.exit(1);
};

const strk = (wei) => Number(wei) / 1e18;
const fmt = (n) => n.toFixed(2).padStart(7);

// ── chain identity ────────────────────────────────────────────────────────────
const id = await rpcCall("starknet_chainId", []);
if (id !== chainId) fail(`wrong chain: expected ${chainId}, got ${id}`);
const block = await rpcCall("starknet_blockNumber", []);
/* Decoded, not the raw felt. "0x534e5f4d41494e" and "mainnet" are the same fact and
   only one of them can be checked at a glance. */
const CHAIN_NAMES = { "0x534e5f4d41494e": "mainnet", "0x534e5f5345504f4c4941": "sepolia" };
console.log(`  chain        ${CHAIN_NAMES[id] ?? "unknown"}  (${id})`);
console.log(`  block        ${block}`);

// ── the pool is the thing we integrate with; if its class moved, our encoding may
//    no longer match what it expects ────────────────────────────────────────────
const cls = await rpcCall("starknet_getClassHashAt", {
  block_id: "latest",
  contract_address: pool,
});
if (BigInt(cls) !== BigInt(poolClass)) {
  fail(
    `pool class hash moved\n    expected ${poolClass}\n    got      ${cls}\n\n` +
      `  The pool has been upgraded. Re-verify the action encoding before deploying:\n` +
      `      node client/scripts/verify-pool-shapes.mjs`,
  );
}
console.log(`  pool         ${pool}`);
console.log(`  pool class   matches`);


// ── money ─────────────────────────────────────────────────────────────────────
const bal = await rpcCall("starknet_call", {
  request: {
    contract_address: STRK,
    entry_point_selector: hash.getSelectorFromName("balanceOf"),
    calldata: [account],
  },
  block_id: "latest",
});
const balance = strk(BigInt(bal[0]) + (BigInt(bal[1] ?? 0) << 128n));

const head = await rpcCall("starknet_getBlockWithTxHashes", { block_id: "latest" });
const pL2 = BigInt(head.l2_gas_price.price_in_fri);
const pD1 = BigInt(head.l1_data_gas_price.price_in_fri);
const cost = (r) => strk(BigInt(r.l2_gas) * pL2 + BigInt(r.l1_data_gas) * pD1);

const steps = (phase === "full" ? PROFILE.steps : PROFILE.steps.slice(0, PROFILE.deploy_steps))
  .filter((s) => !skip.has(s.step));
for (const s of skip) console.log(`  skipping     ${s} (already on chain)`);
const measured = steps.reduce((a, s) => a + cost(s.measured), 0);
const bound = steps.reduce((a, s) => a + cost(s.bound), 0);

console.log(`\n  gas now      l2 ${pL2} · l1_data ${pD1} fri/unit`);
console.log(`  balance      ${fmt(balance)} STRK`);
console.log(`  ${phase === "full" ? "full lifecycle" : "declares + deploys"}`);
console.log(`    expect to spend   ${fmt(measured)} STRK`);
console.log(`    must hold         ${fmt(bound)} STRK   (estimator bound — this is the gate)`);

if (balance < bound) {
  fail(
    `short ${fmt(bound - balance).trim()} STRK.\n\n` +
      `  The estimator will not submit unless the account holds the bound, even though\n` +
      `  the receipt would only charge about ${measured.toFixed(2)}. Top up to ${Math.ceil(bound * 1.15)} STRK and re-run.\n\n` +
      `  Gas moves. This number was computed against block ${block} and is not a promise.`,
  );
}
const headroom = ((balance / bound - 1) * 100).toFixed(0);
console.log(`    headroom          ${headroom.padStart(6)}%`);
if (balance < bound * 1.15) {
  console.log(
    `\n  Thin. Gas can move between now and the last transaction; a rise of more than\n` +
      `  ${headroom}% mid-deploy strands the run with contracts declared and nothing deployed.`,
  );
}
