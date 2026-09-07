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
  const total = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0 });
  /* Split what differs by how much. A gradient ground rasterises a hair differently
     from build to build — every channel within 3 of the other image — across a hundred
     thousand pixels at once, with no element moved. That is dither, reported but not
     failed; a pixel that moved further than that is the diff this tool exists for. */
  let dither = 0, real = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > 3) real++; else if (d > 0) dither++;
  }
  if (real) { writeFileSync(`/tmp/shots/diff/${f}`, PNG.sync.write(out)); bad++; }
  const hint = real > 0 && real < 1000 ? "   ← small: try SHOT_EXTRA_CSS with the glass off (see header) before reading it as a style change" : "";
  const dust = dither ? `  +${dither} dither (Δ≤3)` : "";
  console.log(`${real === 0 ? "ok      " : "DIFF    "} ${f}  ${real} px${dust}  (${A.width}x${A.height})${hint}`);
  void total;
}
console.log(bad === 0 ? "\nzero pixel differences across all pairs" : `\n${bad} file(s) differ`);
