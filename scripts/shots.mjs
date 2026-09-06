/**
 * Screenshots every route at both widths, into a named directory.
 *
 *   node shots.mjs before|after [port]
 *
 * Deterministic on purpose: motion is disabled with `?motion=0` and a stylesheet that
 * kills animation and transition, because a page that is still animating photographs
 * differently every time and a pixel diff of noise proves nothing.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const tag = process.argv[2] ?? "before";
const port = process.argv[3] ?? "3000";
const PAGES = ["/", "/auctions", "/auction/8", "/docs", "/wallet-check",
               "/app", "/app/create", "/app/auctions", "/app/bids", "/app/manage"];
const b = await puppeteer.launch({ executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless:"new", args:["--no-sandbox","--hide-scrollbars","--force-color-profile=srgb"] });
mkdirSync(`/tmp/shots/${tag}`, { recursive: true });
for (const [w,h,name] of [[1440,900,"desk"],[390,844,"mob"]]) {
  for (const path of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width:w, height:h, deviceScaleFactor:1, isMobile:w<768, hasTouch:w<768 });
    try {
      await p.goto(`http://localhost:${port}${path}?motion=0`, { waitUntil:"networkidle0", timeout:45000 });
      await p.addStyleTag({ content:"*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
      await new Promise(r=>setTimeout(r,700));
      const file = `/tmp/shots/${tag}/${name}${path.replace(/\//g,"_")}.png`;
      await p.screenshot({ path:file, fullPage:true });
    } catch (e) { console.log("  skip", name, path, String(e).slice(0,60)); }
    await p.close();
  }
}
await b.close();
console.log(`${tag}: done`);
