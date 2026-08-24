/**
 * Where an address stands with the STRK20 pool, read straight from the chain.
 *
 *   node scripts/pool-status.mjs <address> [--network mainnet|sepolia]
 *
 * Run it before and after shielding. It turns "did that work?" into a fact that does
 * not depend on reading a wallet's UI correctly, and it explains `NOT_REGISTERED`:
 * `get_public_key` returns 0 for an address the pool has never seen, which is the state
 * a first shield leaves behind.
 *
 * Read-only. Nothing signs, nothing moves.
 */
import { RpcProvider, hash } from "starknet";

const args = process.argv.slice(2);
const addr = args.find((a) => a.startsWith("0x"));
const net = args.includes("--network") ? args[args.indexOf("--network") + 1] : "mainnet";
if (!addr) {
  console.error("usage: node scripts/pool-status.mjs <address> [--network mainnet|sepolia]");
  process.exit(1);
}

const NETS = {
  mainnet: {
    rpc: "https://api.cartridge.gg/x/starknet/mainnet",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    explorer: "https://starkscan.co",
  },
  sepolia: {
    rpc: "https://api.cartridge.gg/x/starknet/sepolia",
    pool: "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    explorer: "https://sepolia.voyager.online",
  },
};
const cfg = NETS[net];
if (!cfg) { console.error(`unknown network: ${net}`); process.exit(1); }

const p = new RpcProvider({ nodeUrl: cfg.rpc });
const call = (entrypoint, calldata = []) =>
  p.callContract({ contractAddress: cfg.pool, entrypoint, calldata });

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const strk = (w) => (Number(w) / 1e18).toFixed(4);

console.log(`\n  network   ${net}`);
console.log(`  pool      ${cfg.pool}`);
console.log(`  address   ${addr}\n`);

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
  console.log(`\n  Not registered yet. Shield once from inside the wallet and re-run this.`);
  console.log(`  Budget ${strk(fee)} STRK for the pool fee on top of whatever you shield.`);
} else {
  console.log(`\n  Registered. The wallet can drive the pool from this address.`);
}
/* Shielded balances are deliberately absent: they are private, they need a viewing key,
   and this project never asks for one. Registration is public; balances are not. */
