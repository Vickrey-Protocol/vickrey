"use client";

import { useEffect } from "react";
import { Nav } from "@/components/landing/Nav";
import { LpFooter } from "@/components/landing/Footer";
import { initMotion, onReplayKey, replayMotion } from "@/lib/motion";
import { watchBackdrop, watchGlow, watchScroll } from "@/lib/chrome";
import { watchReveals } from "@/lib/reveal";
import { StaleTabNotice } from "@/components/StaleTabNotice";
import "@/app/landing.css";

/**
 * Chrome and chrome behaviour for the public routes — auctions, an auction, the docs,
 * the wallet check. The same nav and footer as the landing page, on the same world:
 * the `.lp` class puts this page's tokens on <html>, light or dark by the visitor's
 * choice, and the public stylesheet restyles the design system's classes for it.
 *
 * The chrome watchers were wired inside the old single page. Every public route needs
 * them, and a route that forgets one loses the ambient behaviour with no error — so
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
    <div className="lp">
      <Nav />
      {/* The nav floats over the top of the page, so the page starts below it. */}
      <main className="lp-main tw:relative tw:mx-auto tw:max-w-7xl tw:px-4 tw:pt-24 tw:pb-16 tw:lg:pt-32">
        <StaleTabNotice />
        {children}
      </main>
      <LpFooter />
    </div>
  );
}
