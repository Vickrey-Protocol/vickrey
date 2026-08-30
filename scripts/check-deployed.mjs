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
 *
 * GRACE is what lets this run on every push instead of only on a timer. With manual
 * deploys, "main is ahead of live" is the *normal* state for the minutes between pushing
 * and deploying, so a check that fired on that would be red on nearly every push and
 * trained away within a day — which is exactly what happened to the whole workflow it
 * lives in, red for five days over test formatting, until a genuinely stale deploy could
 * hide inside it.
 *
 * So the question it asks is not "is main ahead of live", it is "has main been ahead of
 * live for longer than a deploy takes". That is measured on the *oldest* undeployed
 * commit, not the newest: pushing a second commit must not reset the clock on the first
 * one, or a steady stream of pushes hides the drift indefinitely.
 */
import { execSync } from "node:child_process";

const SITE = process.argv[2] ?? process.env.SITE ?? "https://vickrey.0xo.in";
const GRACE_MIN = Number(process.env.GRACE_MIN ?? 30);
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
  let behind, oldestAgeMin = Infinity;
  try {
    behind = execSync(`git log --oneline ${info.commit}..${head}`).toString().trim();
    /* The oldest undeployed commit's author date. `git log` lists newest first, so the
       last line is the one that has been waiting longest. */
    const oldest = execSync(`git log --format=%ct ${info.commit}..${head}`)
      .toString().trim().split("\n").filter(Boolean).pop();
    if (oldest) oldestAgeMin = (Date.now() / 1000 - Number(oldest)) / 60;
  } catch {
    behind = "(the live commit is not in this clone — a different branch?)";
    oldestAgeMin = Infinity;   // cannot date it, so do not excuse it
  }

  const list = behind.split("\n").map((l) => `    ${l}`).join("\n");

  if (oldestAgeMin < GRACE_MIN) {
    /* Ahead, but not yet late. Reported without failing, so a push shows the state
       without teaching anyone to ignore a red mark. */
    console.log(`\n  ahead of live by ${Math.round(oldestAgeMin)} min ` +
      `(grace ${GRACE_MIN} min) — not stale yet:\n${list}\n\n  Deploy with scripts/deploy-web.sh`);
    process.exit(0);
  }

  fail(`STALE DEPLOY — the site has not served HEAD for ${Math.round(oldestAgeMin)} minutes.` +
    `\n\n  Not live yet:\n${list}\n\n  Run: scripts/deploy-web.sh`);
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
