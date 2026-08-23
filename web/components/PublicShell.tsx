"use client";

import { useEffect } from "react";
import { Masthead } from "@/components/Masthead";
import { Footer } from "@/components/Footer";
import { initMotion, onReplayKey, replayMotion } from "@/lib/motion";
import { watchBackdrop, watchGlow, watchScroll } from "@/lib/chrome";
import { watchReveals } from "@/lib/reveal";

/**
 * Backdrop, masthead, chrome behaviour and footer for the public routes.
 *
 * The chrome watchers were wired inside the old single page. Every public route needs
 * them, and a route that forgets one loses the ambient background with no error — so
 * they live here and a route cannot opt out by omission.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initMotion();
    const offKey = onReplayKey(() => replayMotion());
    const offScroll = watchScroll();
    const offGlow = watchGlow();
    const offBack = watchBackdrop();
    const offReveal = watchReveals();
    return () => { offKey(); offScroll(); offGlow(); offBack(); offReveal(); };
  }, []);

  return (
    <main>
      <div className="backdrop" aria-hidden="true" />
      <Masthead />
      {children}
      <Footer />
    </main>
  );
}
