/**
 * Answers one question in a browser: does a Tailwind utility win against this site's
 * bare-element rules?
 *
 *   node scripts/cascade-probe.mjs [port]
 *
 * It injects a stylesheet in the `utilities` cascade layer — the layer Tailwind emits
 * into — declaring the same thing a `tw:` utility would, then puts that class on a real
 * <h2>, <button> and <input> in the served page and reads back the computed style. A
 * compiled probe would need a source file using the class; this needs nothing but the
 * cascade, which is the thing under test.
 */
import puppeteer from "puppeteer-core";
const port = process.argv[2] ?? "3000";
const b = await puppeteer.launch({ executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless:"new", args:["--no-sandbox"] });
const p = await b.newPage();
await p.goto(`http://localhost:${port}/?motion=0`, { waitUntil:"domcontentloaded" });
await new Promise(r=>setTimeout(r,1500));
const out = await p.evaluate(() => {
  const css = `@layer utilities {
    .tw\\:text-sm { font-size: 14px; }
    .tw\\:font-sans { font-family: Arial; }
    .tw\\:rounded-full { border-radius: 9999px; }
    .tw\\:px-6 { padding-left: 24px; padding-right: 24px; }
    .tw\\:w-auto { width: auto; }
    .tw\\:p-0 { padding: 0; }
  }`;
  const s = document.createElement("style"); s.textContent = css; document.head.append(s);
  const mk = (tag, cls) => { const el = document.createElement(tag); el.className = cls; el.textContent = "x"; document.body.append(el); return getComputedStyle(el); };
  const h = mk("h2", "tw:text-sm tw:font-sans");
  const bt = mk("button", "tw:rounded-full tw:px-6");
  const inp = mk("input", "tw:w-auto");
  const sec = mk("section", "tw:p-0");
  return {
    "h2  tw:text-sm     wins?": h.fontSize === "14px",
    "h2  tw:font-sans   wins?": /Arial/.test(h.fontFamily),
    "button tw:rounded-full": bt.borderRadius === "9999px",
    "button tw:px-6        ": bt.paddingLeft === "24px",
    "input  tw:w-auto      ": inp.width !== `${document.body.clientWidth}px` && !inp.width.endsWith("%"),
    "section tw:p-0        ": sec.paddingTop === "0px",
  };
});
await b.close();
const rows = Object.entries(out);
for (const [k, v] of rows) console.log(`${v ? "wins " : "LOSES"}  ${k}`);
const losses = rows.filter(([, v]) => !v).length;
console.log(losses ? `\n${losses} of ${rows.length}: a bought component would lose here` : `\nutilities win on every claimed element`);
process.exit(losses ? 1 : 0);
