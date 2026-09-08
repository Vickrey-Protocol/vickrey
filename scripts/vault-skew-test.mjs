/**
 * Two tabs, two builds, one origin: does a stale tab still delete a fresh bid?
 *
 * This is the failure that actually happened. The reconciler bug was fixed and deployed,
 * and a tab opened before the deploy kept running the old bundle — deleting every new bid
 * on its 20-second poll for hours. A test with two *current* tabs cannot see that, so this
 * one builds the old bundle and the new one, serves them on the same port in turn, and
 * opens one tab against each. Tab A holds the old JavaScript in memory after the server
 * beneath it is replaced, exactly as a real tab does.
 *
 *   node scripts/vault-skew-test.mjs <oldRef> <newRef>     (default: 33cda34 HEAD)
 *
 * PASS means the seeded bid is still in the vault at the end and the new tab reported a
 * restore. Run it against the build before the cross-tab fix as the control — it must
 * FAIL there, or the test proves nothing.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const REPO = process.cwd();
const SCRATCH = process.env.SKEW_SCRATCH ?? join(process.env.TMPDIR ?? "/tmp", "vickrey-skew");
const PORT = Number(process.env.SKEW_PORT ?? 3450);
const AUCTION = process.env.SKEW_AUCTION ?? "1";   // Sepolia #1: Open, 3 bids
const INDEX = Number(process.env.SKEW_INDEX ?? 3); // == bidCount: unreachable by the search
const KEY = "vickrey.bids.v1";
const [oldRef = "33cda34", newRef = "HEAD"] = process.argv.slice(2);

const sh = (cmd, opts = {}) => (execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }) ?? "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

function prepare(ref) {
  const sha = sh(`git rev-parse ${ref}`), short = sha.slice(0, 7);
  const dir = join(SCRATCH, short);
  if (!existsSync(dir)) {
    mkdirSync(SCRATCH, { recursive: true });
    sh(`git worktree add --detach "${dir}" ${sha}`);
  }
  for (const nm of ["node_modules", "web/node_modules"]) {
    const src = join(REPO, nm), dst = join(dir, nm);
    if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst);
  }
  const env = join(REPO, "web/.env.local");
  if (existsSync(env)) copyFileSync(env, join(dir, "web/.env.local"));
  if (!existsSync(join(dir, "web/.next/BUILD_ID"))) {
    console.log(`[${stamp()}] building ${short} (${ref})…`);
    sh("npx next build", { cwd: join(dir, "web"), stdio: ["ignore", "ignore", "pipe"] });
  }
  return { sha: short, dir };
}

async function serve(dir) {
  const p = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: join(dir, "web"), stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return p; } catch {}
  }
  throw new Error("server did not come up");
}
const stopServer = async (p) => { p.kill("SIGTERM"); await sleep(1500); };

/* Logs this tab's own writes of the key, so drops (old tab) and restores (new tab) are visible. */
const MON = `(()=>{const K=${JSON.stringify(KEY)};window.__w=[];const o=Object.getPrototypeOf(localStorage).setItem;
Object.getPrototypeOf(localStorage).setItem=function(k,v){if(k===K){let n=null;try{n=JSON.parse(v).length}catch{}
window.__w.push({at:Date.now(),entries:n})}return o.call(this,k,v)}})();`;

const oldB = prepare(oldRef), newB = prepare(newRef);
console.log(`\nold: ${oldB.sha} (${oldRef})   new: ${newB.sha} (${newRef})   origin: http://localhost:${PORT}\n`);

const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });
const page = async () => { const p = await browser.newPage(); await p.evaluateOnNewDocument(MON); return p; };

let srv = await serve(oldB.dir);
const A = await page();
await A.goto(`http://localhost:${PORT}/app`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(8000);
console.log(`[${stamp()}] tab A open on OLD bundle (${oldB.sha}); replacing the server beneath it`);
await stopServer(srv);
srv = await serve(newB.dir);
const B = await page();
await B.goto(`http://localhost:${PORT}/app`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(8000);
console.log(`[${stamp()}] tab B open on NEW bundle (${newB.sha})`);

const entry = { auctionId: AUCTION, index: INDEX, level: 2, claimSecret: "TEST", seed: "TEST",
  claimCommitment: "3", upAnchor: "4", downAnchor: "5" };
await B.evaluate((k, e) => localStorage.setItem(k, JSON.stringify([e])), KEY, entry);
console.log(`[${stamp()}] seeded ${AUCTION}:${INDEX} from tab B; watching 75s (old tab polls every 20s)\n`);

const t0 = Date.now(); let last = null; let notice = null;
for (let i = 0; i < 75; i++) {
  await sleep(1000);
  const n = await B.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "[]").length; } catch { return -1; } }, KEY);
  const txt = await B.evaluate(() => document.querySelector("[data-stale-tab]")?.textContent?.trim() ?? null);
  if (n !== last) { console.log(`  +${String(Math.round((Date.now() - t0) / 1000)).padStart(2)}s  vault entries: ${n}`); last = n; }
  if (txt && txt !== notice) { console.log(`  +${String(Math.round((Date.now() - t0) / 1000)).padStart(2)}s  tab B notice: "${txt.slice(0, 120)}…"`); notice = txt; }
}
const final = await B.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "[]").length; } catch { return -1; } }, KEY);
const wA = await A.evaluate(() => window.__w), wB = await B.evaluate(() => window.__w);
console.log(`\ntab A (old) writes: ${wA.map((w) => `${w.entries}@+${Math.round((w.at - t0) / 1000)}s`).join("  ") || "none"}`);
console.log(`tab B (new) writes: ${wB.map((w) => `${w.entries}@+${Math.round((w.at - t0) / 1000)}s`).join("  ") || "none"}`);

/* The seed is tab B's first write; only writes after it are restores. */
const drops = wA.filter((w) => w.entries === 0).length;
const restores = wB.filter((w) => w.entries === 1 && w.at > t0 + 2000).length;
const pass = final === 1 && restores >= 1;
console.log(`\nold tab dropped ${drops}×, new tab restored ${restores}×, entry present at end: ${final === 1}`);
console.log(`\n${pass ? "PASS" : "FAIL"} — ${pass
  ? "a stale tab kept deleting and the current tab kept the bid alive, and said so"
  : final === 1 ? "entry survived but no restore was observed (old tab never dropped?)"
  : "the stale tab deleted the bid and nothing put it back"}`);
await browser.close(); await stopServer(srv);
process.exit(pass ? 0 : 1);
