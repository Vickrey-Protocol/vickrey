/**
 * Per-pixel diff of two screenshot sets. Reports the count, not an impression.
 *
 *   node diff.mjs base tw
 *
 * A size mismatch is a failure in itself — a page that got taller moved something.
 *
 * A small residual on a page with glass is not necessarily a style change. Moving the
 * bare-element rules into `@layer base` left /docs at 1440 differing by 389 px on the
 * glyph edges of two eyebrow labels, while every element's computed style and box was
 * identical to 0.01 px (scripts/style-dump.mjs) and the labels' fonts, text-run rects,
 * every property, ::after and parent were identical. Both labels sit on
 * `backdrop-filter` glass, and with the blur disabled on both sides the page diffed at
 * zero. Text anti-aliased over a blurred surface rasterises differently on the GPU
 * for reasons the DOM cannot see. So before investigating a residual under ~1,000 px:
 *
 *   SHOT_EXTRA_CSS='.panel,.card-auction,.secret,.faq-item,.docs-nav{backdrop-filter:none!important}' \
 *     npm run shots <tag> <port>      # capture both sides this way, then diff again
 *
 * Zero with the glass off means the glass. Anything else is real; use style-dump to name it.
 */
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
const [a, b] = [process.argv[2] ?? "base", process.argv[3] ?? "tw"];
mkdirSync(`/tmp/shots/diff`, { recursive: true });
let bad = 0;
for (const f of readdirSync(`/tmp/shots/${a}`).sort()) {
  const A = PNG.sync.read(readFileSync(`/tmp/shots/${a}/${f}`));
  let B; try { B = PNG.sync.read(readFileSync(`/tmp/shots/${b}/${f}`)); }
  catch { console.log(`MISSING  ${f}`); bad++; continue; }
  if (A.width !== B.width || A.height !== B.height) {
    console.log(`SIZE     ${f}  ${A.width}x${A.height} -> ${B.width}x${B.height}`); bad++; continue;
  }
  const out = new PNG({ width: A.width, height: A.height });
  const n = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0 });
  if (n) { writeFileSync(`/tmp/shots/diff/${f}`, PNG.sync.write(out)); bad++; }
  const hint = n > 0 && n < 1000 ? "   ← small: try SHOT_EXTRA_CSS with the glass off (see header) before reading it as a style change" : "";
  console.log(`${n === 0 ? "ok      " : "DIFF    "} ${f}  ${n} px  (${A.width}x${A.height})${hint}`);
}
console.log(bad === 0 ? "\nzero pixel differences across all pairs" : `\n${bad} file(s) differ`);
