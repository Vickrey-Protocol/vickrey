/**
 * §6c: one transaction that touches the real pool AND emits from a contract we listed.
 *
 *   node scripts/verify-private-tx.mjs <txHash>… [--network sepolia|mainnet]
 *
 * This is the shape every qualifying submission transaction has to have, and it is the
 * one thing `verify-events.mjs` cannot establish: that script drives `privacy_invoke`
 * through `MockPrivacyPool`, which proves our contracts compose but says nothing about
 * whether the *real* pool accepts the encoding and produces a real proof. Only a
 * transaction a wallet actually sent can show that, so this reads one back off the chain
 * rather than constructing it.
 *
 * It asserts three things in a single receipt:
 *
 *   1. `Routed` from the anonymizer — our helper was invoked by the pool
 *   2. `BidPlaced` from the auction — the helper's inner call landed
 *   3. at least one event from the pool itself — it was a real pool operation
 *
 * Any two of those without the third is a different transaction than the rule wants.
 *
 * Read-only.
 */
import { RpcProvider, hash } from "starknet";
import { NETWORKS, describe, resolveNetwork } from "./lib/network.mjs";

const args = process.argv.slice(2);
const hashes = args.filter((a) => a.startsWith("0x"));
if (!hashes.length) {
  console.error("usage: node scripts/verify-private-tx.mjs <txHash>… [--network sepolia|mainnet]");
  process.exit(1);
}

const net = resolveNetwork(args);
const AUCTION = process.env.AUCTION_ADDRESS;
const ANON = process.env.ANONYMIZER_ADDRESS;
if (!AUCTION || !ANON) {
  console.error("set AUCTION_ADDRESS and ANONYMIZER_ADDRESS (see /api/version on the live site)");
  process.exit(1);
}

const p = new RpcProvider({ nodeUrl: net.rpc });
const eq = (a, b) => BigInt(a) === BigInt(b);

/* Only the ones we assert on. Everything else is printed by selector, because guessing
   at a name we did not compute would be inventing evidence. */
const SELECTORS = Object.fromEntries(
  ["Routed", "BidPlaced", "Transfer", "Approval"].map((n) => [hash.getSelectorFromName(n), n]),
);
const who = (a) =>
  eq(a, AUCTION) ? "auction" : eq(a, ANON) ? "anonymizer"
  : eq(a, net.pool) ? "POOL" : `${a.slice(0, 10)}…`;

console.log(`\n  network      ${describe(net)}`);
console.log(`  pool         ${net.pool}`);
console.log(`  auction      ${AUCTION}`);
console.log(`  anonymizer   ${ANON}`);

let bad = 0;
for (const tx of hashes) {
  const r = await p.getTransactionReceipt(tx).catch((e) => ({ error: String(e) }));
  console.log(`\n  ── ${tx}`);
  if (r.error) { console.log(`     could not read: ${r.error.slice(0, 90)}`); bad++; continue; }

  const status = r.execution_status ?? r.finality_status ?? "?";
  console.log(`     ${status} · block ${r.block_number}`);
  for (const e of r.events ?? []) {
    const nm = SELECTORS[e.keys?.[0]] ?? `${e.keys?.[0]?.slice(0, 14)}…`;
    console.log(`     ${who(e.from_address).padEnd(12)} ${nm}`);
  }

  const ev = r.events ?? [];
  const routed = ev.some((e) => eq(e.from_address, ANON) && SELECTORS[e.keys?.[0]] === "Routed");
  const placed = ev.some((e) => eq(e.from_address, AUCTION) && SELECTORS[e.keys?.[0]] === "BidPlaced");
  const pooled = ev.some((e) => eq(e.from_address, net.pool));
  const ok = routed && placed && pooled && status === "SUCCEEDED";

  console.log(`     Routed(anonymizer) ${routed}   BidPlaced(auction) ${placed}   pool events ${pooled}`);
  console.log(`     §6c ${ok ? "PASS" : "FAIL"}`);
  if (!ok) bad++;
}

console.log(bad ? `\n  ${bad} of ${hashes.length} do not qualify.\n`
                : `\n  ${hashes.length} transaction(s) qualify: real pool, both contracts, one tx.\n`);
process.exit(bad ? 1 : 0);
