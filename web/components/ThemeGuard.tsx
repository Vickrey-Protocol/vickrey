"use client";

import { useLayoutEffect } from "react";

/**
 * Re-asserts the visitor's theme after hydration.
 *
 * A pre-paint script in the root layout stamps `data-theme` on <html> from the stored
 * choice. If React ever recovers from a hydration mismatch by rendering from the root,
 * it rebuilds <html>'s attributes from props and the stamp is gone. The one such
 * mismatch is fixed at its source; this is the insurance against the next one, and it
 * runs before paint so a recovered render never shows the wrong theme.
 */
export function ThemeGuard() {
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem("theme") === "dark") document.documentElement.dataset.theme = "dark";
    } catch { /* private mode: the pre-paint script already did what it could */ }
  }, []);
  return null;
}
