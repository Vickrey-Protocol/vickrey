/**
 * Blocks until the Sepolia account can afford the candidate declare, then exits.
 *
 *   node scripts/await-funding.mjs
 *
 * Exists so the declare fires the moment the faucet lands rather than the next time
 * somebody thinks to check. The freeze is on the critical path and the deadline is
 * Monday; an hour lost to nobody looking is an hour that comes off the fix budget.
 *
 * Exit 0 = funded and the declare can start. Exit 1 = gave up waiting; nothing is
 * wrong, just check by hand.
 */
import { RpcProvider, hash } from "starknet";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ACCOUNTS = [
  ["sepolia", "https://api.cartridge.gg/x/starknet/sepolia",
   "0xbf54b8d90403f275fbf0e9db0bb7e2a278bcc0e8b53f3fe71a3e2931c668fa", 70],
  ["mainnet", "https://api.cartridge.gg/x/starknet/mainnet",
   "0x04c475d32f7929507ad3d4691f8e263528355eca074e43b8ac26892fb03ace5f", 66.08],
];

const balance = async (rpc, addr) => {
  const p = new RpcProvider({ nodeUrl: rpc });
  const r = await p.callContract({
    contractAddress: STRK,
    entrypoint: "balanceOf",
    calldata: [addr],
  });
  return Number(BigInt(r[0]) + (BigInt(r[1] ?? 0) << 128n)) / 1e18;
};

const MAX_MINUTES = Number(process.env.MINUTES ?? 55);
for (let i = 0; i < MAX_MINUTES; i++) {
  const seen = [];
  for (const [net, rpc, addr, need] of ACCOUNTS) {
    try {
      const b = await balance(rpc, addr);
      seen.push(`${net} ${b.toFixed(2)}/${need}`);
      /* Either account unblocks work now. Mainnet unblocks the entry itself, so it
         counts as much as Sepolia — with two days left, whichever lands first is the
         one to act on. */
      if (b >= need) {
        console.log(`\n${net.toUpperCase()} FUNDED: ${b.toFixed(2)} STRK.`);
        console.log(seen.join("   "));
        process.exit(0);
      }
    } catch {
      seen.push(`${net} unreachable`);
    }
  }
  if (i % 10 === 0) console.log(`  [${i}m] ${seen.join("   ")}`);
  await new Promise((r) => setTimeout(r, 60_000));
}
console.log("\nStill unfunded after 55 minutes. Not an error — check by hand.");
process.exit(1);
