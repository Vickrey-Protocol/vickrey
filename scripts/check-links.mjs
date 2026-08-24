/**
 * Fetches every outbound URL in the repo and the site, and fails if one is dead.
 *
 * This exists because we have now shipped three dead URLs — a retired Blast RPC, and
 * `sepolia.starkscan.co`, which does not resolve. A judge clicking a contract link and
 * getting DNS_PROBE_FINISHED_NXDOMAIN is worse than having no link at all, and a
 * pattern check would have caught neither: both were well-formed URLs pointing at
 * hosts that had gone away.
 *
 *   node scripts/check-links.mjs            # repo sources
 *   SITE=https://…  node scripts/check-links.mjs   # also crawl the deployed page
 *
 * Exit 1 on any dead link.
 *
 * ── On 403 ──────────────────────────────────────────────────────────────────
 * Cloudflare-fronted explorers (Voyager) refuse automated requests with 403 while
 * serving humans normally. A 403 that arrives *from a real IP* is therefore reported
 * as UNVERIFIABLE rather than dead — it means "a browser must confirm this", not
 * "this is broken". A connection failure with no IP is the genuine death signal, and
 * that is what `sepolia.starkscan.co` returns.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = process.env.SITE ?? "";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", ".next", ".vercel", ".snfoundry_cache", "out",
]);
/* Lockfiles are full of registry tarball URLs. They are resolved by the package
   manager against its own integrity hashes, they are not links anyone clicks, and
   fetching hundreds of them in parallel just makes the registry rate-limit us. */
const SKIP_FILES = new Set(["package-lock.json", "Scarb.lock", "Cargo.lock"]);
const EXTS = new Set([".md", ".ts", ".tsx", ".json", ".mjs", ".cairo", ".toml", ".sh", ".css"]);

/** Hosts we never call: examples, placeholders, and schema identifiers. */
const IGNORE = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/,
  /your-demo\.example|your-org|example\.com/,
  /\$\{|\{\{|<|\s/,                      // templated or malformed fragments
  /openapi\.vercel\.sh/,                 // JSON-schema id, not a page
  /schemastore\.org/,
  /t\.me\/sncorestars/,                  // requires a Telegram client
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name)) && !SKIP_FILES.has(name)) out.push(p);
  }
  return out;
}

/** Collects URLs with the file and line they came from, so a failure is actionable. */
function collect() {
  const found = new Map(); // url -> Set("path:line")
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length);
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const raw of line.match(/https?:\/\/[^\s"'`)\]<>,;]+/g) ?? []) {
        // Strip trailing punctuation and markdown emphasis, so a bolded or
        // sentence-final URL does not arrive with junk stuck to the end. The closing
        // brace comes from shell defaults like ${SITE:-https://example.com} — the URL
        // is real, the brace is not part of it, and reporting it as dead is the kind
        // of false positive that teaches people to ignore this check.
        const url = raw.replace(/[.,:;*_~})\]]+$/, "");
        if (url.includes("\u2026")) continue; // an elided example, not a real URL
        if (IGNORE.some((re) => re.test(url))) continue;
        if (!found.has(url)) found.set(url, new Set());
        found.get(url).add(`${rel}:${i + 1}`);
      }
    });
  }
  return found;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function probe(url) {
  const attempt = async (method) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    try {
      const res = await fetch(url, {
        method, redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA },
      });
      return { status: res.status };
    } finally {
      clearTimeout(timer);
    }
  };
  for (let tryN = 0; tryN < 2; tryN++) {
    try {
      // HEAD first; plenty of hosts answer 405 to it, so fall through to GET.
      let r = await attempt("HEAD");
      if (r.status === 403 || r.status === 405 || r.status === 501) r = await attempt("GET");
      return r;
    } catch (e) {
      // One retry: a transient TLS or socket error is not a dead link, and calling
      // it one would make this check something people learn to ignore.
      if (tryN === 1) return { status: 0, error: String(e?.cause?.code ?? e?.message ?? e) };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { status: 0, error: "unreachable" };
}

const verdict = ({ status }) => {
  if (status >= 200 && status < 400) return "ok";
  // 405 means the host answered and refused the verb — an RPC endpoint that only
  // takes POST is alive, which is the thing being checked.
  if (status === 405 || status === 501) return "ok";
  if (status === 403 || status === 429) return "unverifiable"; // bot-blocked, not dead
  return "dead";
};

const urls = collect();
if (SITE) {
  // Anything the deployed page links out to, which source scanning can miss.
  try {
    const html = await (await fetch(SITE, { headers: { "user-agent": UA } })).text();
    for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      if (IGNORE.some((re) => re.test(m[1]))) continue;
      if (!urls.has(m[1])) urls.set(m[1], new Set());
      urls.get(m[1]).add("deployed site");
    }
  } catch (e) {
    console.error(`could not read ${SITE}: ${e}`);
  }
}

/* Relative markdown links are clickable on GitHub too, and a broken one is the same
   failure with a different error page. Cheap to check, so check it. */
const relBroken = [];
for (const file of walk(ROOT).filter((f) => f.endsWith(".md"))) {
  const rel = file.slice(ROOT.length);
  const dir = file.slice(0, file.lastIndexOf("/"));
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\((?!https?:|mailto:|#)([^)]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target) continue;
      if (!existsSync(join(dir, target))) relBroken.push(`${rel}:${i + 1} → ${target}`);
    }
  });
}

const list = [...urls.keys()].sort();
console.log(`checking ${list.length} unique URLs\n`);

const results = [];
const LIMIT = 8;
for (let i = 0; i < list.length; i += LIMIT) {
  const batch = list.slice(i, i + LIMIT);
  results.push(...(await Promise.all(batch.map(async (url) => ({ url, ...(await probe(url)) })))));
}

let dead = 0, unverifiable = 0;
for (const r of results.sort((a, b) => a.url.localeCompare(b.url))) {
  const v = verdict(r);
  if (v === "ok") continue;
  const where = [...urls.get(r.url)].slice(0, 3).join(", ");
  if (v === "dead") {
    dead++;
    console.log(`DEAD          ${r.url}\n              ${r.status || r.error}  ← ${where}`);
  } else {
    unverifiable++;
    console.log(`bot-blocked   ${r.url}  (${r.status}, needs a browser)`);
  }
}

for (const b of relBroken) console.log(`BROKEN PATH   ${b}`);

console.log(
  `\n${results.length - dead - unverifiable} ok · ${unverifiable} bot-blocked · ` +
  `${dead} dead · ${relBroken.length} broken relative path(s)`,
);
if (dead || relBroken.length) {
  console.log("\nA dead link is worse than no link. Fix or remove them.");
  process.exit(1);
}
