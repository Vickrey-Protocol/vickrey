/**
 * Asserts the hero's motion actually happens.
 *
 *   node scripts/motion-check.mjs [port]
 *
 * `npm run pixel-diff` compares settled pages, and a settled page looks exactly the
 * same whether its animation ran, ran wrong, or never ran at all. Every rule that
 * drives this page's motion is a *hidden* start state — `opacity: 0`, `scaleX(0)` —
 * so losing one leaves the finished frame untouched and pixel-identical. That is the
 * blind spot this file exists to cover: it records the whole way there, frame by
 * frame, and fails if a beat never moved.
 *
 * The three beats are the argument the landing page makes, so each is checked by
 * name rather than by "something animated":
 *
 *   rungs    the ladder resolves in            .rung            opacity 0 → 1
 *   wipe     the clearing line crosses         .is-clearing     scaleX  0 → 1
 *   brace    the band annotation arrives       .brace           opacity 0 → 1
 *   reveals  section content rises into view   [data-reveal]    opacity 0 → 1
 *
 * Reveals are counted only while they are on screen: one below the fold is meant to
 * wait at opacity 0 for a scroll, and folding those into the minimum reports a
 * working page as stuck.
 *
 * A beat whose element is not on the page is reported NOT EXERCISED and fails the
 * run. Absence of an answer is not a negative answer (CONTRIBUTING rule 11): a page
 * served without auction data has no clearing rung and no brace, so two of the three
 * beats silently cannot be observed — and a check that passed on that would be
 * certifying the thing it never looked at.
 */
import puppeteer from "puppeteer-core";

const port = process.argv[2] ?? "3000";
const url = `http://localhost:${port}/`;

/* Sampling happens inside the page, once per frame. Polling over the wire from Node
   lands wherever the round trip lands and routinely steps straight over a 500ms beat. */
/* Beats registered by name. Each is an element carrying `data-beat="<name>"`; a section
   that animates adds its name here, and the run fails if that element is missing or
   never moved. The first ones are above the fold; scrolled beats follow the same rule
   further down. */
const NAMED_BEATS = ["nav", "hero-copy", "problem", "how", "properties", "auctions", "faq"];

const RECORDER = () => {
  const seen = { rung: [], wipe: [], brace: [], reveal: [], motion: [], named: {} };
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const scaleX = (t) => (t && t !== "none" ? num(t.slice(t.indexOf("(") + 1)) : null);
  const tick = () => {
    const rung = document.querySelector(".rung");
    const clearing = document.querySelector(".rung.is-clearing");
    const brace = document.querySelector(".brace");
    /* Only the ones on screen. A reveal below the fold is *supposed* to sit at
       opacity 0 waiting for a scroll that has not happened, and folding those into
       the minimum reports the page as stuck when it is working exactly as designed. */
    const reveals = [...document.querySelectorAll("[data-reveal]")].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    });
    if (rung) seen.rung.push(num(getComputedStyle(rung).opacity));
    if (clearing) seen.wipe.push(scaleX(getComputedStyle(clearing, "::after").transform));
    if (brace) seen.brace.push(num(getComputedStyle(brace).opacity));
    if (reveals.length) seen.reveal.push(Math.min(...reveals.map((r) => num(getComputedStyle(r).opacity))));
    for (const el of document.querySelectorAll("[data-beat]")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      /* A slide-in starts off screen by design, so a `ty` beat is sampled wherever it
         is; an opacity beat below the fold is meant to wait, so it is sampled only
         once on screen. */
      if (el.dataset.beatProp !== "ty" && !(r.top < innerHeight && r.bottom > 0)) continue;
      /* A beat is normally an opacity. `data-beat-prop="ty"` names one that is a slide:
         the nav enters from y −80, so its progress is how much of that is left. */
      let v = num(cs.opacity);
      if (el.dataset.beatProp === "ty") {
        const m = cs.transform.match(/matrix\(([^)]+)\)/);
        const ty = m ? Math.abs(num(m[1].split(",")[5])) : 0;
        v = 1 - Math.min(1, ty / 80);
      }
      (seen.named[el.dataset.beat] ??= []).push(v);
    }
    seen.motion.push(document.documentElement.dataset.motion ?? "-");
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  Object.defineProperty(window, "__motion", { get: () => seen });
  window.__resetMotion = () => { for (const k of Object.keys(seen)) seen[k].length = 0; };
};

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--no-sandbox", "--hide-scrollbars"],
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

/* ── first load ─────────────────────────────────────────────────────────── */
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.evaluateOnNewDocument(RECORDER);
await p.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));
const load = await p.evaluate(() => window.__motion);

const beat = (label, samples, floor = 0.5) => {
  if (!samples.length) return check(label, false, "NOT EXERCISED — no such element on the page");
  const lo = Math.min(...samples), hi = Math.max(...samples), end = samples.at(-1);
  const moved = lo < floor && end > 0.99;
  check(label, moved, `min ${lo.toFixed(2)} → end ${end.toFixed(2)} over ${samples.length} frames` +
    (moved ? "" : lo >= floor ? "  (never started hidden — the start state was lost)"
                              : "  (never finished — it is stuck part-way)"));
  return hi;
};

check("motion engages", load.motion.includes("play"),
  `data-motion saw [${[...new Set(load.motion)].join(", ")}]`);
beat("beat 1 · rungs resolve in", load.rung);
beat("beat 2 · clearing line wipes across", load.wipe);
beat("beat 3 · brace arrives", load.brace);
beat("reveals rise into view", load.reveal);
/* Beats above the fold are judged from the load recording; the rest are scrolled to
   below, one at a time, and judged from a fresh recording each. */
const scrolled = NAMED_BEATS.filter((n) => !(load.named[n]?.length));
for (const name of NAMED_BEATS) if (!scrolled.includes(name)) beat(`named · ${name}`, load.named[name]);

/* ── replay ─────────────────────────────────────────────────────────────── */
try {
  if (!(await p.$(".rig-replay"))) throw new Error("no .rig-replay control on the page");
  await p.evaluate(() => window.__resetMotion());
  await p.click(".rig-replay");
  await new Promise((r) => setTimeout(r, 2600));
  beat("replay re-runs the rungs", (await p.evaluate(() => window.__motion)).rung);
} catch (e) {
  /* A thrown click is a failed check, not a crashed run — the other beats still
     have something to say and the report is worth more whole than aborted. */
  check("replay re-runs the rungs", false, `NOT EXERCISED — ${String(e.message).slice(0, 70)}`);
}

/* ── scrolled beats ─────────────────────────────────────────────────────── */
for (const name of scrolled) {
  const found = await p.evaluate((n) => {
    const el = document.querySelector(`[data-beat="${n}"]`);
    if (!el) return false;
    window.__resetMotion();
    el.scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  }, name);
  if (!found) { check(`named · ${name}`, false, `NOT EXERCISED — nothing on the page carries data-beat="${name}"`); continue; }
  await new Promise((r) => setTimeout(r, 1400));
  beat(`named · ${name} (scrolled to)`, (await p.evaluate(() => window.__motion)).named[name] ?? []);
}

/* ── reduced motion ─────────────────────────────────────────────────────── */
const q = await b.newPage();
await q.setViewport({ width: 1440, height: 900 });
await q.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await q.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2000));
const still = await q.evaluate(() => {
  const hidden = [...document.querySelectorAll("[data-reveal]")]
    .filter((n) => parseFloat(getComputedStyle(n).opacity) < 0.99).length;
  return { motion: document.documentElement.dataset.motion, hidden };
});
check("reduced motion lands settled, hiding nothing",
  still.motion === "still" && still.hidden === 0,
  `data-motion=${still.motion}, ${still.hidden} reveal(s) left hidden`);

await b.close();

const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} of ${results.length} checks failed` : `\nall ${results.length} beats verified`);
process.exit(bad ? 1 : 0);
