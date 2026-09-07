/**
 * Screenshots every route at both widths, into a named directory.
 *
 *   node shots.mjs before|after [port]
 *
 * Deterministic on purpose: motion is disabled with `?motion=0` and a stylesheet that
 * kills animation and transition, because a page that is still animating photographs
 * differently every time and a pixel diff of noise proves nothing.
 *
 * That determinism is also the limit of what this proves. Freezing motion means the
 * capture cannot see motion, and every rule driving this site's animation is a hidden
 * *start* state — so a build whose hero never animates photographs pixel-for-pixel
 * identically to one that does. `npm run check:motion` covers that; this does not.
 *
 * Run one server at a time. Several `next start` processes against the same RPC
 * starve each other and pages photograph half-rendered.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { FAKE_WALLET, SEPOLIA } from "./lib/fake-wallet.mjs";
const tag = process.argv[2] ?? "before";
const port = process.argv[3] ?? "3000";
/* Override when the configured deployment holds different auction ids:
   SHOT_ROUTES=/,/auctions,/auction/1 npm run shots before 3000 */
const PAGES = (process.env.SHOT_ROUTES ?? "/,/auctions,/auction/8,/docs,/wallet-check," +
               "/app,/app/create,/app/auctions,/app/bids,/app/manage").split(",");
const b = await puppeteer.launch({ executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless:"new", args:["--no-sandbox","--hide-scrollbars","--force-color-profile=srgb"] });
mkdirSync(`/tmp/shots/${tag}`, { recursive: true });
let failures = 0;
for (const [w,h,name] of [[1440,900,"desk"],[390,844,"mob"]]) {
  for (const path of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width:w, height:h, deviceScaleFactor:1, isMobile:w<768, hasTouch:w<768 });
    try {
      /* SHOT_THEME=dark captures the page as a visitor who chose dark sees it: the
         choice is stored before navigation, exactly where the pre-paint script reads it. */
      /* SHOT_WALLET=0x… photographs the dashboard connected: the camera wallet is injected,
         remembered under the app's own key so the silent reconnect picks it up with no
         click, and the first-visit tour is marked seen so it does not cover the page. */
      if (process.env.SHOT_WALLET) {
        await p.evaluateOnNewDocument(FAKE_WALLET, process.env.SHOT_WALLET, SEPOLIA);
        await p.evaluateOnNewDocument(() => { try { localStorage.setItem("vickrey.wallet", "Camera"); localStorage.setItem("vickrey.tour.v1", "done"); } catch {} });
      }
      if (process.env.SHOT_THEME) await p.evaluateOnNewDocument((t) => { try { localStorage.setItem("theme", t); } catch {} }, process.env.SHOT_THEME);
      const res = await p.goto(`http://localhost:${port}${path}?motion=0`, { waitUntil:"networkidle0", timeout:45000 });
      /* A screenshot of an error page diffs perfectly against another screenshot of the
         same error page. Without this the harness will happily "prove" two broken builds
         identical, which is worse than no proof at all. */
      if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`);
      /* An error page has a sentence and a handful of elements. A short real page — a
         dashboard route with nothing to list — has little text and a full shell. */
      const real = await p.$eval("body", (b) => ({ chars: b.innerText.trim().length, nodes: b.querySelectorAll("*").length }));
      if (real.chars < 200 && real.nodes < 40) throw new Error(`page is empty (${real.chars} chars, ${real.nodes} elements)`);
      await p.addStyleTag({ content:"*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
      /* SHOT_EXTRA_CSS lets a diff isolate one rendering feature — e.g. capture both sides
         with backdrop-filter off to test whether a residual delta lives in the glass. */
      if (process.env.SHOT_EXTRA_CSS) await p.addStyleTag({ content: process.env.SHOT_EXTRA_CSS });
      await new Promise(r=>setTimeout(r, process.env.SHOT_WALLET ? 4500 : 700));
      const file = `/tmp/shots/${tag}/${name}${path.replace(/\//g,"_")}.png`;
      await p.screenshot({ path:file, fullPage:true });
    } catch (e) { console.log("  FAILED", name, path, String(e).slice(0,70)); failures++; }
    await p.close();
  }
}
await b.close();
console.log(`${tag}: ${failures ? `${failures} route(s) FAILED to capture` : "done"}`);
process.exit(failures ? 1 : 0);
