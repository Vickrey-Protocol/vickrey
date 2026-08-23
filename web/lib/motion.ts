"use client";

/**
 * The three motion beats, and when they run.
 *
 * **On every load.** An earlier version gated this behind a first-visit flag in
 * `localStorage`, which was a mistake: the settlement animation is the argument the
 * page exists to make, and anyone who had opened the site once never saw it again —
 * including, in practice, the people reviewing it. Suppressing it is now opt-in
 * rather than automatic.
 *
 *   default     the beats run
 *   ?motion=0   force the settled state
 *   ?motion=1   force the beats, even where they would otherwise be suppressed
 *   press R     replay, as does the control on the instrument
 *
 * `prefers-reduced-motion` still wins unless `?motion=1` says otherwise.
 */
const prefersReduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sets `data-motion` on the root, which is what the stylesheet keys off. */
export function setMotion(play: boolean) {
  document.documentElement.dataset.motion = play && !prefersReduced() ? "play" : "still";
}

/** Decides the opening state. Returns whether the beats are actually running. */
export function initMotion(): boolean {
  const forced = new URLSearchParams(location.search).get("motion");
  if (forced === "0") {
    setMotion(false);
    return false;
  }
  if (forced === "1") {
    // An explicit request beats the reduced-motion preference, so a recording is
    // reproducible on any machine.
    document.documentElement.dataset.motion = "play";
    return true;
  }
  setMotion(true);
  return !prefersReduced();
}

/** Restarts the beats. Re-keying the animated subtree is the caller's job. */
export function replayMotion(): boolean {
  setMotion(false);
  // A frame at "still" so the animations actually restart rather than continue.
  requestAnimationFrame(() => requestAnimationFrame(() => setMotion(true)));
  return !prefersReduced();
}

/** `R` replays, unless the visitor is typing. */
export function onReplayKey(handler: () => void): () => void {
  const listener = (e: KeyboardEvent) => {
    if (e.key !== "r" && e.key !== "R") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    handler();
  };
  addEventListener("keydown", listener);
  return () => removeEventListener("keydown", listener);
}
