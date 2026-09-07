/**
 * Does the reconciler delete a vault entry it cannot prove absent?
 *
 * Seeds the vault with one entry, loads the dashboard, and reports whether it survived.
 * Two cases, chosen so a correct build answers them differently:
 *
 *   index == bidCount  the search cannot reach the entry -> no answer -> MUST KEEP
 *   index <  bidCount  the search covered it and found nothing -> MUST DROP
 *
 * A build that keeps both is not fixed, it is just inert. A build that drops both is the
 * bug. Sepolia auction #1 is Open with 3 bids, so index 3 and index 1 give both cases.
 */
import puppeteer from "puppeteer-core";
import { FAKE_WALLET, SEPOLIA } from "./lib/fake-wallet.mjs";
const MAINNET = "0x534e5f4d41494e";

const BASE = process.argv[2];
const AUCTION = process.argv[3] ?? "1";
/* Which chain the target build talks to, and the two indices that make the cases. */
const CHAIN = process.argv[4] === "mainnet" ? MAINNET : SEPOLIA;
const UNREACHABLE = Number(process.argv[5] ?? 3);
const COVERED = Number(process.argv[6] ?? 1);
const W = "0x079676fd0e0e1f0e0e1f0e0e1f0e0e1f0e0e1f0e0e1f0e0e1f0e0e1f0e0e1f0";
const KEY = "vickrey.bids.v1";

const entry = (index) => ({
  auctionId: AUCTION, index, level: 2,
  /* Deliberately not a commitment any real bid carries, so the chain search must fail. */
  claimSecret: "111", seed: "222", claimCommitment: "99999999999999999999",
  upAnchor: "333", downAnchor: "444",
});

const run = async (index) => {
  const b = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.evaluateOnNewDocument(FAKE_WALLET, W, CHAIN);
  await p.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
  const click = (src) => p.evaluate((s) => {
    const rx = new RegExp(s, "i");
    const el = [...document.querySelectorAll("button,[role=button],a")]
      .find((n) => rx.test((n.textContent || "").trim()));
    if (el) { el.click(); return true; } return false;
  }, src);
  await click("^connect"); await new Promise(r => setTimeout(r, 1200));
  await click("camera");   await new Promise(r => setTimeout(r, 4000));

  await p.evaluate((k, e) => localStorage.setItem(k, JSON.stringify([e])), KEY, entry(index));
  await p.goto(BASE + "/app", { waitUntil: "networkidle2", timeout: 60000 });
  /* Long enough for readAll + the reconcile pass, which does one RPC per bid index. */
  await new Promise(r => setTimeout(r, 12000));
  const after = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), KEY);
  await b.close();
  return after.length;
};

const cannotReach = await run(UNREACHABLE); // index == bidCount -> must survive
const covered     = await run(COVERED);     // index <  bidCount -> must be dropped
console.log(`  index ${UNREACHABLE} (search cannot reach it) : ${cannotReach === 1 ? "KEPT   ✅" : "DELETED ❌"}`);
console.log(`  index ${COVERED} (search covered it)      : ${covered === 0 ? "DROPPED ✅" : "kept    (stale row left)"}`);
