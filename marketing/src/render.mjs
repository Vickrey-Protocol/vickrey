/**
 * Renders the launch clips and the X banner from the HTML in this folder.
 *
 *   node marketing/src/render.mjs stills [t]     one still per clip, wide + square (default t per clip)
 *   node marketing/src/render.mjs banner         banner.png + banner-preview.png
 *   node marketing/src/render.mjs video [clip…]  6 s at 30 fps, frame by frame, → H.264
 *
 * Frames are rendered, not recorded: each page's CSS animations are paused and seeked
 * to exact times (clip.js), so every frame is reproducible and nothing depends on how
 * fast the machine is. Needs Playwright (PLAYWRIGHT=/path/to/playwright/index.mjs if it
 * isn't resolvable from here) and ffmpeg. Output goes to marketing/clips/ (gitignored).
 */
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, "..", "clips");
const CLIPS = {
  "1-ladder": 4.2, "2-chains": 4.2, "3-record": 4.2, "4-fee-card": 4.4, "5-stale-tab": 4.4,
};
const SHAPES = { "1920x1080": { width: 1920, height: 1080 }, "1080x1080": { width: 1080, height: 1080 } };
const FPS = 30, DURATION = 6;
const [mode = "stills", ...rest] = process.argv.slice(2);
mkdirSync(join(OUT, "stills"), { recursive: true });

const browser = await chromium.launch();
async function open(file, viewport, query = "") {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(SRC, file)).href + query);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  return page;
}

if (mode === "stills") {
  for (const [clip, tDefault] of Object.entries(CLIPS)) {
    const t = rest[0] ?? tDefault;
    for (const [size, vp] of Object.entries(SHAPES)) {
      const page = await open(clip + ".html", vp, `?t=${t}`);
      await page.screenshot({ path: join(OUT, "stills", `${clip}-${size}-t${t}.png`) });
      await page.close();
    }
    console.log("still", clip, "t=" + t);
  }
}

if (mode === "banner") {
  for (const [q, name] of [["", "banner.png"], ["?preview", "banner-preview.png"]]) {
    const page = await open("banner.html", { width: 1500, height: 500 }, q);
    await page.screenshot({ path: join(OUT, name) });
    await page.close();
  }
  console.log("banner.png, banner-preview.png");
}

if (mode === "video") {
  for (const clip of rest.length ? rest : Object.keys(CLIPS)) {
    for (const [size, vp] of Object.entries(SHAPES)) {
      const dir = join(OUT, ".frames", `${clip}-${size}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const page = await open(clip + ".html", vp, "?t=0");
      for (let f = 0; f < FPS * DURATION; f++) {
        await page.evaluate((t) => window.__seek(t), f / FPS);
        await page.screenshot({ path: join(dir, String(f).padStart(4, "0") + ".png") });
      }
      await page.close();
      execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "%04d.png"),
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", join(OUT, `${clip}-${size}.mp4`)]);
      rmSync(dir, { recursive: true, force: true });
      console.log("video", `${clip}-${size}.mp4`);
    }
  }
}
await browser.close();
