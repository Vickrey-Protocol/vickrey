"use client";

/**
 * Whether the first-run tour has been seen, and a way to ask for it again.
 *
 * Persisted, because "shown once" that forgets on reload is shown every time — and a
 * modal that reappears after you dismissed it is worse than never showing it.
 *
 * The replay control lives in the wallet menu and the tour renders inside the dashboard
 * shell; neither owns the other. A custom event connects them without threading state
 * through the wallet provider, which has enough in it already.
 */
const KEY = "vickrey.tour.v1";
export const TOUR_EVENT = "vickrey:tour";

export function tourSeen(): boolean {
  if (typeof window === "undefined") return true;   // never flash it during SSR
  try { return window.localStorage.getItem(KEY) === "done"; } catch { return true; }
}

export function markTourSeen() {
  try { window.localStorage.setItem(KEY, "done"); } catch { /* private mode */ }
}

/** Asks whoever is listening to open the tour. Safe to call from anywhere. */
export function replayTour() {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}
