/**
 * Dumps the computed style and box of every element on one route, so two builds can
 * be compared by *which element and which property* changed rather than by pixels.
 *
 *   node scripts/style-dump.mjs <port> <path> <width> <out.json>
 *   node scripts/style-dump.mjs --diff a.json b.json
 */
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync } from "node:fs";
const PROPS = ["font-family","font-size","font-weight","letter-spacing","line-height","text-wrap","text-transform",
  "color","background-color","background-image","box-sizing","display","position","margin-top","margin-bottom",
  "margin-left","margin-right","padding-top","padding-bottom","padding-left","padding-right","border-top-width",
  "border-radius","width","height","gap","flex","grid-template-columns","opacity","transform","text-decoration-color",
  "outline-offset","cursor","overflow-x","color-scheme","-webkit-font-smoothing","-webkit-text-size-adjust"];
if (process.argv[2] === "--diff") {
  const [a, b] = [process.argv[3], process.argv[4]].map((f) => JSON.parse(readFileSync(f, "utf8")));
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k] || !b[k]) { console.log(`${!a[k] ? "+" : "-"} ${k}`); n++; continue; }
    for (const p of Object.keys(a[k])) if (a[k][p] !== b[k][p]) { if (n < 60) console.log(`${k}\n    ${p}: ${a[k][p]}  →  ${b[k][p]}`); n++; }
  }
  console.log(n ? `\n${n} difference(s)` : "\nno computed-style or box differences");
  process.exit(0);
}
const [port, path, width, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless:"new", args:["--no-sandbox","--hide-scrollbars"] });
const p = await b.newPage();
const w = +width; await p.setViewport({ width:w, height:900, deviceScaleFactor:1, isMobile:w<768, hasTouch:w<768 });
await p.goto(`http://localhost:${port}${path}?motion=0`, { waitUntil:"networkidle0", timeout:45000 });
await p.addStyleTag({ content:"*,*::before,*::after{animation:none!important;transition:none!important}" });
await new Promise((r) => setTimeout(r, 700));
const dump = await p.evaluate((PROPS) => {
  const pathOf = (el) => { const parts=[]; for (let e=el; e && e!==document.body; e=e.parentElement) { const i=[...e.parentElement.children].indexOf(e); parts.unshift(`${e.tagName.toLowerCase()}${e.className&&typeof e.className==="string"?"."+e.className.trim().split(/\s+/).join("."):""}[${i}]`);} return parts.join(">"); };
  const out = {};
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), o = {};
    for (const q of PROPS) o[q] = cs.getPropertyValue(q);
    o.box = [r.x, r.y + scrollY, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(",");
    out[pathOf(el)] = o;
  }
  return out;
}, PROPS);
writeFileSync(out, JSON.stringify(dump));
console.log(`${Object.keys(dump).length} elements → ${out}`);
await b.close();
