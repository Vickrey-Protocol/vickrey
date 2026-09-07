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
import { hash } from "starknet";
import { classify, whyNot } from "./lib/qualifying.mjs";

/* Copied from the hub, deliberately, rather than from our own config: the question is
   what *it* will do, so its constants are the right ones even where ours agree. */
/* The hub hardcodes the mainnet pool, and so does this by default. The override exists
   so the whole check can be rehearsed against Sepolia before it matters — which is how
   its ability to tell a private-rail bid from a public one was actually tested. It must
   be unset for the real check, and the banner below always says which chain was read,
   because a verdict that does not name its chain is not a verdict. */
const POOL = process.env.POOL_ADDRESS
  || "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const MIN_MAINNET_TXS = 3;
const RPCS = [
  /* Cartridge, because it is the one mainnet endpoint verified to answer every method
     this check needs — the same reasoning, and the same URL, as scripts/deploy.sh.
     The previous default (rpc.starknet.lava.build) is dead: it does not answer
     starknet_chainId at all. That is worse than a wrong answer, because the check
     degrades quietly — a live contract reads back as network "unknown" and a
     qualifying transaction cannot be fetched, so the gate that is supposed to refuse a
     bad submission would have refused a good one, minutes before the deadline. */
  ["mainnet", process.env.MAINNET_RPC_URL || "https://api.cartridge.gg/x/starknet/mainnet"],
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
const rehearsing = !!(process.env.MAINNET_RPC_URL || process.env.POOL_ADDRESS);
console.log("\n  strk20.json, read the way the hub reads it");
console.log(`  chain read      ${RPCS[0][1]}`);
console.log(`  pool            ${POOL}`);
if (rehearsing) {
  console.log("  MODE            REHEARSAL — overridden endpoints, not what the hub will see");
}
console.log("");

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
    if (await rpc(url, "starknet_getClassHashAt", ["latest", address])) {
      /* `RPCS[0]` is labelled mainnet, but the URL can be overridden for a rehearsal —
         so the label would otherwise call a Sepolia contract "mainnet". */
      network = name === "mainnet" && rehearsing ? "first endpoint" : name;
      break;
    }
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
/**
 * Declaring contracts is a commitment, not a protection.
 *
 * An empty `contracts` array is credited on pool contact alone, because the hub leaves
 * `mine` as `null` and counts `mine !== false`. Declaring addresses raises our own bar:
 * every listed hash must then also run through one of them. So the dangerous combination
 * is *declared contracts alongside a bare shield* — the shield stops counting, silently,
 * and three passing transactions can become zero.
 *
 * That was a warning in the runbook, which is a thing somebody has to remember at
 * midnight. It is an assertion here: with contracts declared, every listed transaction
 * must be a private-rail bid, and anything else fails the check outright even if enough
 * others would still satisfy the hub. A hash that does not belong in the list is a
 * mistake worth failing on rather than tolerating.
 */
const ROUTED = hash.getSelectorFromName("Routed");
const notPrivateRail = [];

for (const raw of declaredTxs.slice(0, 10)) {
  const txHash = typeof raw === "string" ? raw.trim() : "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(txHash)) {
    console.log(`    ${String(raw).slice(0, 24)}  not a transaction hash — skipped`);
    continue;
  }
  const receipt = await rpc(RPCS[0][1], "starknet_getTransactionReceipt", [txHash]);
  if (!receipt) { console.log(`    ${txHash.slice(0, 16)}…  NOT FOUND on mainnet`); continue; }

  /* Only fetched when it might change the answer, exactly as the hub does. */
  let calldata = [];
  if (own.length) {
    const tx = await rpc(RPCS[0][1], "starknet_getTransactionByHash", [txHash]);
    calldata = Array.isArray(tx?.calldata) ? tx.calldata : [];
  }

  const c = classify(receipt, calldata, { pool: POOL, own, routedKey: ROUTED });
  if (c.countedByHub) verified++;

  const why = whyNot(c);
  const note = c.countedByHub
    ? (c.ours === null ? "counts (no contracts declared — judged on pool alone)"
       : c.routed ? "counts · private-rail bid"
       : "counts for the hub, but NOT a private-rail bid")
    : why;
  console.log(`    ${txHash.slice(0, 16)}…  ${c.countedByHub ? "COUNTS " : "no     "} ${note}`);

  if (own.length && !c.privateRail) notPrivateRail.push([txHash, why ?? "not a private-rail bid"]);
}

/* ── the verdict, in the hub's own terms ──────────────────────────────────── */
const req = { demo: !!demo, video: !!video, mainnet: verified >= MIN_MAINNET_TXS };
console.log(`\n  verified_txs    ${verified} of ${MIN_MAINNET_TXS} required`);
console.log(`  requirements    ${JSON.stringify(req)}`);
const ready = Object.values(req).every(Boolean);
console.log(`\n  ${ready ? "READY — the hub would credit this entry." : "NOT READY — " +
  Object.entries(req).filter(([, v]) => !v).map(([k]) => k).join(", ") + " outstanding."}`);

if (own.length && notPrivateRail.length) {
  console.log("\n  DECLARED CONTRACTS, BUT NOT EVERY HASH GOES THROUGH THEM\n");
  for (const [h, why] of notPrivateRail) console.log(`    ${h.slice(0, 20)}…  ${why}`);
  console.log("");
  console.log("  With contracts declared, every listed transaction must run through one of");
  console.log("  them — a hash that does not is either dead weight or, if you are relying on");
  console.log("  it, a transaction the hub will not count. Remove it, or replace it with a");
  console.log("  private-rail bid. `npm run verify:private <hash>` checks one in isolation.\n");
  process.exit(1);
}

console.log("");
process.exit(ready ? 0 : 1);
