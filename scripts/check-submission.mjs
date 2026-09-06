/**
 * Would the hub credit our entry? Asked the way the hub asks it.
 *
 *   node scripts/check-submission.mjs
 *
 * `strk20.json` has now been wrong twice in the same way: fields whose *shape* the hub
 * would not read. First `contracts` was an object keyed by name where the spec wants a
 * flat array. Both times the file looked complete and would have scored nothing.
 *
 * So this does not check the file against the spec's prose. It reproduces the logic in
 * the hub's own `scripts/build-projects.mjs`, function by function, and reports the same
 * verdict it will:
 *
 *   requirements = { demo: !!demoUrl, video: !!demo_video, mainnet: verifiedTxs >= 3 }
 *   verifiedTxs  = transactions.filter(t => t.ok && t.pool && t.mine !== false).length
 *
 * THE TRAP, and it runs opposite to intuition. `mine` is `null` when a project declares
 * no contracts, and `null !== false`, so a project that declares nothing is credited on
 * pool contact alone. Declaring contracts *raises* the bar: every transaction must then
 * also show one of our addresses, in its events or anywhere in its calldata, or `mine`
 * becomes `false` and it stops counting. Filling in `contracts` can therefore turn three
 * passing transactions into zero. That is worth knowing before deploy day, not after.
 *
 * Read-only. Mainnet, because that is the only chain the hub looks at for this.
 */
import { readFileSync } from "node:fs";

/* Copied from the hub, deliberately, rather than from our own config: the question is
   what *it* will do, so its constants are the right ones even where ours agree. */
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const MIN_MAINNET_TXS = 3;
const RPCS = [
  ["mainnet", process.env.MAINNET_RPC_URL || "https://rpc.starknet.lava.build"],
  ["sepolia", process.env.SEPOLIA_RPC_URL || "https://api.cartridge.gg/x/starknet/sepolia"],
];

const same = (a, b) => {
  try { return BigInt(a) === BigInt(b); } catch { return false; }
};

async function rpc(url, method, params) {
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((x) => x.json());
    return r.error ? null : r.result;
  } catch { return null; }
}

const m = JSON.parse(readFileSync("strk20.json", "utf8"));
console.log("\n  strk20.json, read the way the hub reads it\n");

/* ── demo ─────────────────────────────────────────────────────────────────── */
/* The hub falls back to Pages, the repo Website field, then a deployment, so a blank
   `demo_url` is not necessarily a miss — but only an explicit value is ours to control. */
const demo = m.demo_url || "";
console.log(`  demo_url        ${demo || "(empty — hub will try Pages / Website / deployment)"}`);

/* ── video ────────────────────────────────────────────────────────────────── */
/* `!!entry.demo_video`. Never fetched, never validated, never length-checked. A
   non-empty string passes the machine; a human panel still has to be able to open it. */
const video = m.demo_video || "";
console.log(`  demo_video      ${video || "(EMPTY — requirement `video` will be false)"}`);

/* ── contracts ────────────────────────────────────────────────────────────── */
const declaredContracts = Array.isArray(m.contracts) ? m.contracts : [];
if (!Array.isArray(m.contracts) && m.contracts !== undefined) {
  console.log("  contracts       NOT AN ARRAY — the hub ignores it entirely");
}
const own = [];
console.log(`  contracts       ${declaredContracts.length} declared`);
for (const raw of declaredContracts) {
  const address = typeof raw === "string" ? raw : raw?.address;
  if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
    console.log(`    ${String(address).slice(0, 20)}  NOT A FELT — hub warns and skips`);
    continue;
  }
  let network = "unknown";
  for (const [name, url] of RPCS) {
    if (await rpc(url, "starknet_getClassHashAt", ["latest", address])) { network = name; break; }
  }
  console.log(`    ${address.slice(0, 14)}…  ${network}`);
  own.push(address);
}

/* ── transactions ─────────────────────────────────────────────────────────── */
const declaredTxs = Array.isArray(m.transactions) ? m.transactions : [];
if (!Array.isArray(m.transactions) && m.transactions !== undefined) {
  console.log("  transactions    NOT AN ARRAY — the hub ignores it entirely");
}
console.log(`  transactions    ${declaredTxs.length} declared (the hub reads the first 10)\n`);

let verified = 0;
for (const raw of declaredTxs.slice(0, 10)) {
  const hash = typeof raw === "string" ? raw.trim() : "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
    console.log(`    ${String(raw).slice(0, 24)}  not a transaction hash — skipped`);
    continue;
  }
  const receipt = await rpc(RPCS[0][1], "starknet_getTransactionReceipt", [hash]);
  if (!receipt) { console.log(`    ${hash.slice(0, 16)}…  NOT FOUND on mainnet`); continue; }

  const events = receipt.events || [];
  const ok = receipt.execution_status === "SUCCEEDED";
  const pool = events.some((e) => same(e.from_address, POOL));

  let mine = null;
  if (own.length) {
    mine = events.some((e) => own.some((a) => same(e.from_address, a)));
    if (!mine) {
      const tx = await rpc(RPCS[0][1], "starknet_getTransactionByHash", [hash]);
      const cd = Array.isArray(tx?.calldata) ? tx.calldata : [];
      mine = cd.some((f) => own.some((a) => same(f, a)));
    }
  }

  const counts = ok && pool && mine !== false;
  if (counts) verified++;
  const why = !ok ? "reverted"
    : !pool ? "did not touch the pool"
    : mine === false ? "touched the pool, but not through our contracts — DOES NOT COUNT"
    : mine === null ? "counts (no contracts declared, so judged on pool alone)"
    : "counts (ran through our contract)";
  console.log(`    ${hash.slice(0, 16)}…  ${counts ? "COUNTS " : "no     "} ${why}`);
}

/* ── the verdict, in the hub's own terms ──────────────────────────────────── */
const req = { demo: !!demo, video: !!video, mainnet: verified >= MIN_MAINNET_TXS };
console.log(`\n  verified_txs    ${verified} of ${MIN_MAINNET_TXS} required`);
console.log(`  requirements    ${JSON.stringify(req)}`);
const ready = Object.values(req).every(Boolean);
console.log(`\n  ${ready ? "READY — the hub would credit this entry." : "NOT READY — " +
  Object.entries(req).filter(([, v]) => !v).map(([k]) => k).join(", ") + " outstanding."}`);

if (own.length && declaredTxs.length) {
  const excluded = declaredTxs.length - verified;
  if (excluded > 0) {
    console.log(`\n  NOTE: ${own.length} contract(s) are declared, which means every transaction`);
    console.log(`  must also run through one of them. Declaring contracts raises this bar —`);
    console.log(`  with none declared these would be judged on pool contact alone.`);
  }
}
console.log("");
process.exit(ready ? 0 : 1);
