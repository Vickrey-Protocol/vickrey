"use client";

/**
 * Whether the first-run tour has been seen, where it got to, and a way to ask for it
 * again from anywhere.
 *
 * Persisted, because "shown once" that forgets on reload is shown every time — and a
 * modal that reappears after you dismissed it is worse than never showing it. The step
 * is kept for the session so a reload mid-tour resumes rather than restarts.
 *
 * Replay is a flag plus an event. The event reaches a tour that is already mounted; the
 * flag reaches one that is about to be, because the replay control lives in the wallet
 * menu, which is on every page, and the tour lives only in the dashboard shell.
 */
const KEY = "vickrey.tour.v1";
const STEP = "vickrey.tour.v1.step";
const REPLAY = "vickrey.tour.v1.replay";
export const TOUR_EVENT = "vickrey:tour";

export function tourSeen(): boolean {
  if (typeof window === "undefined") return true;   // never flash it during SSR
  try { return window.localStorage.getItem(KEY) === "done"; } catch { return true; }
}

export function markTourSeen() {
  try { window.localStorage.setItem(KEY, "done"); window.sessionStorage.removeItem(STEP); } catch { /* private mode */ }
}

export function savedStep(): number {
  try { return Math.max(0, Number(window.sessionStorage.getItem(STEP) ?? 0) || 0); } catch { return 0; }
}
export function saveStep(i: number) {
  try { window.sessionStorage.setItem(STEP, String(i)); } catch { /* private mode */ }
}

/** Set by the replay control; read and cleared by the tour when it mounts. */
export function replayRequested(): boolean {
  try {
    const yes = window.sessionStorage.getItem(REPLAY) === "1";
    if (yes) window.sessionStorage.removeItem(REPLAY);
    return yes;
  } catch { return false; }
}

/**
 * Asks for the tour again. A mounted tour opens on the event; one that mounts later —
 * because the caller was on a public page and is now navigating to the dashboard —
 * opens on the flag.
 */
export function replayTour() {
  try { window.sessionStorage.setItem(REPLAY, "1"); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}
