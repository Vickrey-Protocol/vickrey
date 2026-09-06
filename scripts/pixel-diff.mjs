/**
 * Per-pixel diff of two screenshot sets. Reports the count, not an impression.
 *
 *   node diff.mjs base tw
 *
 * A size mismatch is a failure in itself — a page that got taller moved something.
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
  console.log(`${n === 0 ? "ok      " : "DIFF    "} ${f}  ${n} px  (${A.width}x${A.height})`);
}
console.log(bad === 0 ? "\nzero pixel differences across all pairs" : `\n${bad} file(s) differ`);
