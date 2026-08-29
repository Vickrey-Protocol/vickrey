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
/**
 * The backdrop no longer tracks the pointer.
 *
 * It used to reveal an ember copy of the grid around the cursor, which tinted whatever
 * cell you happened to be over on every page. Decorative, and it pulled the eye away
 * from the numbers — on a page whose whole claim is what the numbers do and do not say,
 * that is the wrong thing to animate.
 *
 * Kept as a no-op so the callers that unsubscribe it stay unchanged.
 */
export function watchBackdrop(): () => void {
  return () => {};
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
