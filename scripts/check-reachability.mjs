/**
 * Fails if a state-changing contract entrypoint cannot be reached from the interface.
 *
 * `abandon` shipped in the contract with seven tests and a section in the docs, and no
 * button anywhere. Every individual check passed: the Cairo was tested, the UI was
 * tested, the documentation was accurate. Nothing asserted the relationship *between*
 * them, and that relationship is its own property.
 *
 * So this is written the way the conservation test is written — one invariant over the
 * whole surface rather than a list of cases somebody remembered to add:
 *
 *   every external entrypoint is either reached by the app, or declared here as
 *   deliberately not user-facing, with a reason.
 *
 * And a second, because the first one passed while a real gap was open. `seal` and
 * `finalize` have no caller check in the contract — anyone may call them, which is what
 * stops an auctioneer stalling an auction by refusing to seal it — but the action queue
 * offered both only to the auctioneer. The entrypoint was reachable; it was not
 * reachable *by the person who needs it*. Reachability alone cannot see that, so:
 *
 *   for every entrypoint, the role the UI offers it to matches the role the contract
 *   admits.
 *
 * The contract side is read from the Cairo rather than declared, so it cannot drift.
 *
 * Adding an entrypoint therefore forces a decision. Forgetting to wire one up fails the
 * build; deciding it should not be wired up costs one line and an explanation.
 *
 *   node scripts/check-reachability.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const CLASSES = [
  ["SealedBidAuction", "target/release/auction_SealedBidAuction.contract_class.json"],
  ["AuctionAnonymizer", "target/release/anonymizer_AuctionAnonymizer.contract_class.json"],
];

/**
 * Entrypoints a user is not expected to reach from this app, and why.
 *
 * "Nobody has asked for it" is not a reason. Each of these is unreachable *by design*,
 * and the design is stated so the next person can disagree with it.
 */
const NOT_USER_FACING = {
  privacy_invoke:
    "Callable only by the STRK20 pool — the helper asserts the caller. A user reaches it " +
    "indirectly by bidding on the private rail; a button would be a call that always reverts.",
};

/**
 * Who the interface offers each entrypoint to. Declared, because no static read of React
 * can tell you who a button is *for* — and asserted below against what the contract
 * actually restricts, so a mismatch in either direction fails.
 *
 *   "anyone"     — no caller check in the contract; the app must not narrow it
 *   "auctioneer" — the contract asserts `get_caller_address() == config.auctioneer`
 *   "holder"     — gated on holding the bid's claim secret, not on an address
 */
const UI_ROLE = {
  create_auction: "anyone",
  place_bid: "anyone",
  seal: "anyone",
  settle: "auctioneer",
  dispute: "anyone",
  finalize: "anyone",
  abandon: "anyone",
  claim_refund: "holder",
  redeem_forfeit: "holder",
  claim_lot: "holder",
};

/**
 * What the Cairo actually restricts: an entrypoint is auctioneer-only exactly when its
 * body asserts the caller against `config.auctioneer`.
 */
function contractRoles(src) {
  const roles = {};
  const re = /fn\s+(\w+)\s*\(\s*ref self: ContractState/g;
  const starts = [];
  for (let m; (m = re.exec(src)); ) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const [name, at] = starts[i];
    const body = src.slice(at, i + 1 < starts.length ? starts[i + 1][1] : src.length);
    roles[name] = /get_caller_address\(\)\s*==\s*config\.auctioneer/.test(body)
      ? "auctioneer"
      : "anyone";
  }
  return roles;
}

/** Views are reads. They are reachable by definition or the pages would not render. */
const isExternal = (fn) => fn.state_mutability !== "view";

function entrypoints() {
  const found = [];
  for (const [name, file] of CLASSES) {
    let abi;
    try {
      abi = JSON.parse(readFileSync(file, "utf8")).abi;
    } catch {
      console.error(`cannot read ${file} — run: scarb -P release build`);
      process.exit(1);
    }
    const walk = (items) =>
      items.forEach((i) => {
        if (i.type === "function" && isExternal(i)) found.push({ contract: name, fn: i.name });
        if (i.type === "interface") walk(i.items ?? []);
      });
    walk(typeof abi === "string" ? JSON.parse(abi) : abi);
  }
  return found;
}

/** Everything the browser could actually run. Tests and scripts do not count. */
function appSources() {
  const roots = ["web/app", "web/components", "web/lib", "client/src"];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if ([".ts", ".tsx"].includes(extname(name))) out.push(p);
    }
  };
  for (const r of roots) { try { walk(r); } catch { /* optional root */ } }
  return out;
}

const sources = appSources().map((f) => ({ file: f, text: readFileSync(f, "utf8") }));

/**
 * An entrypoint is reached if a file that makes contract calls names it as a string.
 *
 * Matching only `entrypoint: "seal"` was too narrow and reported five false failures:
 * plenty of call sites pass the name through a helper — `invoke("seal", …)` — so the
 * literal and the `entrypoint:` key are on different lines. Requiring both the quoted
 * name *and* evidence that the file calls contracts keeps it honest without matching
 * prose: a comment mentioning "settle" in a file that never calls anything does not
 * count, and neither does a file that calls contracts but never names this entrypoint.
 */
const CALLS_CONTRACTS = /entrypoint\s*:|account\.execute|strk20InvokeTransaction|selector!/;

/**
 * Comments are stripped before matching, and backticks are not treated as quotes.
 *
 * Both matter, and the first version of this file got them wrong: doc comments here are
 * written in markdown, so `seal` and `abandon` appear backticked all over the prose. The
 * check counted those and reported entrypoints reachable on the strength of a sentence
 * describing them. A control that disabled the real call site still passed — which is
 * the failure mode this whole file exists to prevent, reproduced inside the file itself.
 */
const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const reachedBy = (fn) =>
  sources
    .filter(({ text }) => {
      const code = stripComments(text);
      return CALLS_CONTRACTS.test(code) && new RegExp(`["']${fn}["']`).test(code);
    })
    .map(({ file }) => file);

let unreachable = 0;
console.log("  entrypoint            reached from\n");
for (const { contract, fn } of entrypoints()) {
  const hits = reachedBy(fn);
  if (hits.length) {
    console.log(`  ok    ${fn.padEnd(16)} ${hits.map((h) => h.replace(/^web\//, "")).join(", ")}`);
  } else if (NOT_USER_FACING[fn]) {
    console.log(`  --    ${fn.padEnd(16)} not user-facing by design`);
  } else {
    unreachable++;
    console.log(`  FAIL  ${fn.padEnd(16)} NOTHING IN THE APP CALLS THIS  (${contract})`);
  }
}

if (unreachable) {
  console.log(
    `\n  ${unreachable} entrypoint(s) exist in the contract and cannot be reached.\n` +
    `  Either wire one up, or add it to NOT_USER_FACING with the reason.`,
  );
  process.exit(1);
}
/* ── roles ──────────────────────────────────────────────────────────────────
   Reachability said yes to `seal` and `finalize` while the queue offered both only to
   the auctioneer, and the contract restricts neither. Reached-by-someone is not
   reached-by-whoever-needs-it. */
const cairo = readFileSync("packages/auction/src/auction.cairo", "utf8");
const actual = contractRoles(cairo);
const roleProblems = [];

console.log("\n  entrypoint            contract allows   UI offers to\n");
for (const { fn } of entrypoints()) {
  if (NOT_USER_FACING[fn]) continue;
  const allows = actual[fn];
  const offers = UI_ROLE[fn];
  if (!offers) {
    roleProblems.push(`${fn}: no UI_ROLE declared — say who this is for.`);
    continue;
  }
  if (allows === undefined) continue;   // not on the auction contract
  /* `holder` is a claim-secret gate rather than an address one, and the contract's own
     check is the commitment, not the caller — so "anyone" on both sides is the match. */
  const narrowed = allows === "anyone" && offers === "auctioneer";
  const widened = allows === "auctioneer" && offers !== "auctioneer";
  const mark = narrowed || widened ? "FAIL " : "ok   ";
  console.log(`  ${mark} ${fn.padEnd(16)} ${String(allows).padEnd(17)} ${offers}`);
  if (narrowed) {
    roleProblems.push(
      `${fn}: the contract lets anyone call it, the app offers it only to the auctioneer. ` +
      `Permissionless steps exist so nobody can stall an auction; hiding them defeats that.`);
  }
  if (widened) {
    roleProblems.push(
      `${fn}: the contract restricts this to the auctioneer, the app offers it to ${offers}. ` +
      `That is a button that reverts for everyone else.`);
  }
}

if (roleProblems.length) {
  console.log("\n  ROLE MISMATCH\n");
  for (const p of roleProblems) console.log(`    ${p}`);
  console.log("");
  process.exit(1);
}

console.log("\n  every external entrypoint is reachable, by a role the contract admits.");
