"use client";

/**
 * Scroll-triggered reveals, in the same motion language as the instrument.
 *
 * Safety first, because this animates real content including the trust statement:
 * the hidden state exists **only** under `[data-motion="play"]`, which nothing but
 * `initMotion` sets. If the script never runs, or `IntersectionObserver` is missing,
 * or the observer throws, every element is simply visible. There is no path where a
 * failure here hides a disclosure a reader is entitled to.
 */
export function watchReveals(): () => void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (!nodes.length) return () => {};

  const show = (el: HTMLElement) => el.setAttribute("data-shown", "true");

  if (typeof IntersectionObserver !== "function") {
    nodes.forEach(show);
    return () => {};
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        show(e.target as HTMLElement);
        io.unobserve(e.target);
      }
    },
    // Fire a little before the element arrives, so it has finished by the time it
    // is properly in view rather than animating under the reader's eyes.
    { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
  );

  nodes.forEach((n) => io.observe(n));

  // Anything already on screen at load reveals immediately rather than waiting for
  // a scroll that may never come.
  requestAnimationFrame(() => {
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) {
        show(n);
        io.unobserve(n);
      }
    }
  });

  return () => io.disconnect();
}
