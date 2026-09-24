/*
  Deterministic timeline. Every CSS animation on the page is paused and driven from here,
  so a frame at time t is exactly reproducible:
    ?t=3.2        freeze at 3.2 s (stills)
    window.__seek(t)  used by render.mjs to step frame by frame
    no parameter  plays in real time, looping every 6 s (for looking at it in a browser)
*/
const DURATION = 6;
window.__seek = (t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; });
window.__ready = document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => {
  const t = new URLSearchParams(location.search).get("t");
  if (t !== null) window.__seek(Number(t));
  else { const t0 = performance.now(); const tick = (now) => { window.__seek(((now - t0) / 1000) % DURATION); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  document.documentElement.dataset.ready = "1"; r();
})));
