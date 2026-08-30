/**
 * Walks every page at each narrow breakpoint and reports what actually breaks.
 *
 *   node scripts/mobile-audit.mjs [baseUrl]
 *
 * Three things it can see that reading CSS cannot:
 *   - which element is wider than the viewport, by name, rather than "something overflows"
 *   - every interactive target under 44px, measured after layout
 *   - information that exists only in a `title`, which does not exist on touch
 *
 * Driving the installed Chrome through puppeteer-core rather than downloading one.
 *
 * It checks four widths, because one is not a layout: the bands have different rules and
 * a single 390px pass says nothing about the tablet. 1024 is included precisely because
 * nothing is supposed to change there — it is the control, and a target that fails only
 * at 1024 means a narrow rule has leaked into the desktop.
 *
 * What it still cannot see is whether a layout looks *squeezed*. It reported ten clean
 * pages while the masthead was three stacked rows with the links crammed into a strip.
 * Numbers confirm; they do not judge. Look at the screenshots.
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "https://vickrey.0xo.in";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = ["/", "/auctions", "/auction/3", "/docs", "/wallet-check",
               "/app", "/app/create", "/app/auctions", "/app/bids", "/app/manage"];
const BANDS = [
  { name: "S ", width: 375, height: 812, touch: true },
  { name: "M ", width: 414, height: 896, touch: true },
  { name: "L ", width: 768, height: 1024, touch: true },
  /* Not a touch band. It is here as a control: nothing may overflow, and no narrow
     rule may leak in. Measuring 44px targets against a mouse would report the
     signed-off desktop as broken on every page, every run. */
  { name: "XL", width: 1024, height: 900, touch: false },
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

let problems = 0;
for (const band of BANDS) {
console.log(`\n\u2500\u2500 ${band.name.trim()}  ${band.width}px \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
const VIEWPORT = {
  width: band.width, height: band.height, deviceScaleFactor: 2,
  isMobile: band.touch, hasTouch: band.touch,
};
for (const path of PAGES) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 45000 });
  } catch { console.log(`\n${path}\n  could not load`); await page.close(); continue; }
  await new Promise((r) => setTimeout(r, 1200));

  const report = await page.evaluate((vw) => {
    const label = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}…"` : ""}`;
    };
    const out = { docWidth: document.documentElement.scrollWidth, overflow: [], small: [], hover: [] };

    /* Two different failures, and only checking one of them missed the obvious ones.
       A box wider than the viewport is the first. The second is a box that fits but
       whose *content* does not — long text or a wide table inside a correctly-sized
       parent — which clips silently under `overflow-x: clip` and is why the landing page
       looked fine to the first version of this script and cut off in a screenshot. */
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      /* A wide table inside a horizontally scrollable container is contained, not
         overflowing — the page does not move, the container does. Flagging those made
         the report noisy about the one case that is already handled. */
      let scrollableAncestor = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto" || ox === "scroll") { scrollableAncestor = true; break; }
      }
      const tooWide = !scrollableAncestor && (r.right > vw + 1 || r.left < -1);
      /* "Content is wider than its box" is not by itself a problem: a full-width child
         at a non-zero offset, or an absolutely-positioned label beside an 8px brace,
         both report it while sitting comfortably on screen. What matters is whether the
         content actually reaches past the viewport, so that is what is measured. */
      const spills = el.scrollWidth > el.clientWidth + 1 &&
        getComputedStyle(el).overflowX === "visible" &&
        r.left + el.scrollWidth > vw + 1;
      if (tooWide || spills) offenders.push({ el, r, why: tooWide ? "wider than viewport" : "content spills" });
    }
    /* Outermost only — a wide parent makes every descendant look wide. */
    for (const o of offenders) {
      if (offenders.some((p) => p.el !== o.el && p.el.contains(o.el))) continue;
      out.overflow.push({ sel: label(o.el), why: o.why,
        right: Math.round(o.r.right), scroll: o.el.scrollWidth, client: o.el.clientWidth });
    }

    for (const el of document.querySelectorAll("a, button, summary, input, select, [role=button]")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && (r.height < 44 || r.width < 24)) {
        out.small.push({ sel: label(el), h: Math.round(r.height), w: Math.round(r.width) });
      }
      const t = el.getAttribute("title");
      if (t && t.length > 24) out.hover.push({ sel: label(el), title: t.slice(0, 48) });
    }
    for (const el of document.querySelectorAll("[title]")) {
      const t = el.getAttribute("title");
      if (t && t.length > 24 && !out.hover.some((h) => h.title === t.slice(0, 48)))
        out.hover.push({ sel: label(el), title: t.slice(0, 48) });
    }
    out.overflow = out.overflow.slice(0, 8);
    out.small = out.small.slice(0, 10);
    return out;
  }, VIEWPORT.width);

  const bad = report.docWidth > VIEWPORT.width || report.overflow.length || report.hover.length
    || (band.touch && report.small.length);
  if (bad) problems++;
  console.log(`\n${path}${bad ? "" : "   clean"}`);
  if (report.docWidth > VIEWPORT.width)
    console.log(`  DOC WIDTH ${report.docWidth}px > ${VIEWPORT.width}px viewport`);
  for (const o of report.overflow)
    console.log(`  overflow   ${o.sel}\n               ${o.why}, right ${o.right}px, scroll ${o.scroll} vs client ${o.client}`);
  if (band.touch) for (const s of report.small) console.log(`  target     ${s.sel}  ${s.w}x${s.h}px`);
  for (const h of report.hover) console.log(`  hover-only ${h.sel}  title="${h.title}…"`);
  await page.close();
}
}

await browser.close();
console.log(`\n${problems} of ${PAGES.length * BANDS.length} page/width combinations have problems`);
