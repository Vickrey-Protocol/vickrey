"use client";

/**
 * The three motion beats, and when they are allowed to run.
 *
 * They play on a visitor's first arrival and then stay out of the way — an
 * auctioneer refreshing all day should not sit through them. Recording a demo
 * needs the opposite, so playback is deterministic three ways:
 *
 *   ?motion=1   force the beats        ?motion=0   force the settled state
 *   press R     replay                 the replay control
 *
 * `localStorage` throws outright in a private window or with site data blocked,
 * so every access is guarded; a failure just means the motion plays.
 */
const KEY = "vickrey.motion.seen";

const seen = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const markSeen = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* nothing to remember it with; the beats simply play again */
  }
};

const prefersReduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sets `data-motion` on the root, which is what the stylesheet keys off. */
export function setMotion(play: boolean) {
  document.documentElement.dataset.motion = play && !prefersReduced() ? "play" : "still";
}

/** Decides the opening state. Returns whether the beats are running. */
export function initMotion(): boolean {
  const forced = new URLSearchParams(location.search).get("motion");
  if (forced === "0") {
    setMotion(false);
    return false;
  }
  if (forced === "1") {
    setMotion(true);
    return true;
  }
  const already = seen();
  setMotion(!already);
  if (!already) markSeen();
  return !already && !prefersReduced();
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
