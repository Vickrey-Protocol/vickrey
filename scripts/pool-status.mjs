/**
 * Where an address stands with the STRK20 pool, read straight from the chain.
 *
 *   node scripts/pool-status.mjs <address> [--network mainnet|sepolia]
 *
 * It defaulted to mainnet, which made it report "not registered" for an address that had
 * just shielded on Sepolia — a confident negative about a question nobody asked. The
 * network is resolved explicitly now, printed with the reason it was chosen, and a
 * negative is checked against the other chain before it is reported as a no.
 *
 * Run it before and after shielding. It turns "did that work?" into a fact that does
 * not depend on reading a wallet's UI correctly, and it explains `NOT_REGISTERED`:
 * `get_public_key` returns 0 for an address the pool has never seen, which is the state
 * a first shield leaves behind.
 *
 * Read-only. Nothing signs, nothing moves.
 */
import { RpcProvider } from "starknet";
import { NETWORKS, STRK, describe, other, resolveNetwork } from "./lib/network.mjs";

const args = process.argv.slice(2);
const addr = args.find((a) => a.startsWith("0x"));
if (!addr) {
  console.error("usage: node scripts/pool-status.mjs <address> [--network mainnet|sepolia]");
  process.exit(1);
}

const cfg = resolveNetwork(args);
const net = cfg.network;

const p = new RpcProvider({ nodeUrl: cfg.rpc });
const call = (entrypoint, calldata = []) =>
  p.callContract({ contractAddress: cfg.pool, entrypoint, calldata });

const strk = (w) => (Number(w) / 1e18).toFixed(4);

/**
 * Whether anything is deployed at the address on a given chain.
 *
 * "not registered" and "there is no contract here" are different answers and the script
 * gave the first for both. An undeployed address is the normal state of a counterfactual
 * Starknet account — it has an address before it has code — so this is not an error, it
 * is a distinct and much more useful fact than a bare no.
 */
async function deployedOn(name) {
  const n = NETWORKS[name];
  try {
    const r = await fetch(n.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "starknet_getClassHashAt",
        params: { contract_address: addr, block_id: "latest" },
      }),
    }).then((x) => x.json());
    return !r.error;
  } catch { return false; }
}

/** Registration on any chain, used both here and to check the other one. */
async function registrationOn(name) {
  const n = NETWORKS[name];
  const q = new RpcProvider({ nodeUrl: n.rpc });
  try {
    const r = await q.callContract({
      contractAddress: n.pool, entrypoint: "get_public_key", calldata: [addr],
    });
    const key = BigInt(r[0]);
    if (key === 0n) return { registered: false };
    let channels = 0n;
    try {
      const c = await q.callContract({
        contractAddress: n.pool, entrypoint: "get_num_of_channels", calldata: [addr],
      });
      channels = BigInt(c[0]);
    } catch { /* none */ }
    return { registered: true, key, channels };
  } catch {
    return { registered: false, unreadable: true };
  }
}

/* Named every time, with where the choice came from. A status line that does not say
   which chain it read is not a status. */
console.log(`\n  network   ${describe(cfg)}`);
console.log(`  pool      ${cfg.pool}`);
console.log(`  address   ${addr}\n`);

const isDeployed = await deployedOn(net);
if (!isDeployed) {
  const alsoNot = !(await deployedOn(other(net)));
  console.log(`  NO CONTRACT AT THIS ADDRESS on ${net}${alsoNot ? ` or ${other(net)}` : ""}.`);
  console.log(`  Everything below would read as a bare "no", which is not the same answer.`);
  if (alsoNot) {
    console.log(`\n  A Starknet account has an address before it has code, so this is the`);
    console.log(`  normal state of an account that has never sent a transaction. If you`);
    console.log(`  shielded from a wallet, that wallet's account is deployed — so this is`);
    console.log(`  probably not the address you shielded from. Check the wallet's own`);
    console.log(`  address field rather than a derived or copied one.\n`);
  } else {
    console.log(`  It IS deployed on ${other(net)} — re-run with --network ${other(net)}.\n`);
  }
  process.exit(1);
}

const fee = BigInt((await call("get_fee_amount"))[0]);
const paused = BigInt((await call("is_paused"))[0]);
console.log(`  pool fee        ${strk(fee)} STRK per operation`);
console.log(`  pool paused     ${paused ? "YES — nothing will work" : "no"}`);

/* The registration question. Zero means the pool has never seen this address, which is
   precisely what NOT_REGISTERED reports. */
let pub = 0n;
try { pub = BigInt((await call("get_public_key", [addr]))[0]); } catch { /* treat as absent */ }
const registered = pub !== 0n;
console.log(`  registered      ${registered ? "YES" : "no — this is what NOT_REGISTERED means"}`);
if (registered) console.log(`  pool public key ${"0x" + pub.toString(16)}`);

let channels = 0n;
try { channels = BigInt((await call("get_num_of_channels", [addr]))[0]); } catch { /* none */ }
console.log(`  channels        ${channels}`);

const bal = await p.callContract({
  contractAddress: STRK, entrypoint: "balanceOf", calldata: [addr],
});
console.log(`  public STRK     ${strk(BigInt(bal[0]) + (BigInt(bal[1] ?? 0) << 128n))}`);

console.log(`\n  ${cfg.explorer}/contract/${addr}`);

if (!registered) {
  /* Before reporting a no, ask the other chain. "Not registered on mainnet" is a true
     sentence and a useless one when the shield happened on Sepolia — and it is the exact
     answer this script gave. */
  const elsewhere = await registrationOn(other(net));
  if (elsewhere.registered) {
    console.log(`\n  NOT registered on ${net} — but this address IS registered on ${other(net)}`);
    console.log(`  (${elsewhere.channels} channel(s) there). You are almost certainly asking`);
    console.log(`  about the wrong chain. Re-run with:\n`);
    console.log(`    node scripts/pool-status.mjs ${addr} --network ${other(net)}\n`);
  } else {
    console.log(`\n  Not registered yet, and not on ${other(net)} either — checked both.`);
    console.log(`  Shield once from inside the wallet and re-run this.`);
    console.log(`  Budget ${strk(fee)} STRK for the pool fee on top of whatever you shield.`);
  }
} else {
  console.log(`\n  Registered on ${net}. The wallet can drive the pool from this address.`);
}
/* Shielded balances are deliberately absent: they are private, they need a viewing key,
   and this project never asks for one. Registration is public; balances are not. */
