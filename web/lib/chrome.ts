"use client";

/**
 * The two bits of chrome that need a listener rather than pure CSS.
 *
 * Both are deliberately tiny: a scroll flag on the root, and two custom
 * properties for the card glow. No animation library — the polish did not
 * justify shipping one, and the bundle is part of what a judge experiences.
 */

/** Marks the root once the page has scrolled, so the header can condense. */
export function watchScroll(): () => void {
  const set = () => {
    document.documentElement.dataset.scrolled = String(window.scrollY > 8);
  };
  set();
  addEventListener("scroll", set, { passive: true });
  return () => removeEventListener("scroll", set);
}

/**
 * Lights the background grid around the pointer. Writes two custom properties on
 * a single fixed element rather than tracking hundreds of grid cells.
 */
export function watchBackdrop(): () => void {
  const el = document.querySelector<HTMLElement>(".backdrop");
  if (!el) return () => {};
  let frame = 0;
  const onMove = (e: PointerEvent) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      el.style.setProperty("--gx", `${e.clientX}px`);
      el.style.setProperty("--gy", `${e.clientY}px`);
    });
  };
  addEventListener("pointermove", onMove, { passive: true });
  return () => {
    removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}

/**
 * Points the glow at the cursor. One delegated listener rather than one per
 * card, and it only writes to elements that opted in with `.glow`.
 */
export function watchGlow(): () => void {
  const onMove = (e: PointerEvent) => {
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(".glow");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  addEventListener("pointermove", onMove, { passive: true });
  return () => removeEventListener("pointermove", onMove);
}
