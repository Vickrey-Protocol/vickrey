/**
 * Fails if the live site is not serving the commit you think it is.
 *
 *   node scripts/check-deployed.mjs [url]
 *
 * This exists because it already happened: four commits sat on `main` — a whole route
 * restructure — while the deployed URL served the previous build. Nothing reported it.
 * The repo was right, the site was plausible, and the only way anyone would have found
 * out was by clicking a route that returned 404.
 *
 * The failure was structural: the Vercel project had no git repository connected, so a
 * push triggered nothing and every deploy was somebody remembering to run a command.
 * This check is the part that does not depend on remembering.
 *
 * Exit 1 on drift, on an unknown commit, or on a route that should exist and does not.
 */
import { execSync } from "node:child_process";

const SITE = process.argv[2] ?? process.env.SITE ?? "https://vickrey-ten.vercel.app";
const head = execSync("git rev-parse HEAD").toString().trim();

const fail = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };

let info;
try {
  const res = await fetch(`${SITE}/api/version`, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) fail(`${SITE}/api/version returned ${res.status}.\n  ` +
    `If this is a 404 the live build predates this check — deploy once with\n  ` +
    `scripts/deploy-web.sh and it will work from then on.`);
  info = await res.json();
} catch (e) {
  fail(`could not reach ${SITE}: ${e.message}`);
}

console.log(`  site    ${SITE}`);
console.log(`  live    ${info.commit}`);
console.log(`  HEAD    ${head}`);
console.log(`  network ${info.network ?? "unset"}`);

if (info.commit === "unknown") {
  fail(`The live build does not know its own commit.\n  ` +
    `Deploy with scripts/deploy-web.sh, which stamps it, or connect the git repo.`);
}
if (info.commit !== head) {
  const behind = (() => {
    try {
      return execSync(`git log --oneline ${info.commit}..${head}`).toString().trim();
    } catch { return "(the live commit is not in this clone — a different branch?)"; }
  })();
  fail(`STALE DEPLOY — the site is not serving HEAD.\n\n  Not live yet:\n` +
    behind.split("\n").map((l) => `    ${l}`).join("\n") +
    `\n\n  Run: scripts/deploy-web.sh`);
}

/* A matching commit still is not proof the routes are there — a build can succeed and
   route wrong. Cheap to check the ones a judge would open. */
const ROUTES = ["/", "/auctions", "/auction/0", "/app"];
const bad = [];
for (const r of ROUTES) {
  const res = await fetch(`${SITE}${r}`, { redirect: "follow" }).catch(() => null);
  if (!res || res.status >= 400) bad.push(`${r} → ${res ? res.status : "unreachable"}`);
}
if (bad.length) fail(`Commit matches but routes are missing:\n` + bad.map((b) => `    ${b}`).join("\n"));

console.log(`\n  in sync · ${ROUTES.length} routes live`);
