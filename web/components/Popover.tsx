"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A panel anchored to a button, rendered at the document root.
 *
 * The portal is not tidiness. `.dash-top` carries `backdrop-filter: blur(14px)`, and a
 * filter — backdrop or otherwise — makes an element the containing block for every
 * `position: fixed` descendant. So a panel written as a bottom sheet was pinned to the
 * bottom of the 64px topbar instead of the viewport, and its full-screen veil covered the
 * topbar and nothing else. On desktop the anchored panel happened to land in roughly the
 * right place, which is what kept it hidden: it only showed up at 390px.
 *
 * Escaping to `document.body` fixes both, and leaves the panel outside the topbar's
 * `z-index: 5` stacking context as well.
 *
 * Position then has to be computed rather than inherited, and it is published as custom
 * properties so the narrow breakpoint can ignore them and become a bottom sheet without
 * fighting inline styles.
 */
export function Popover({
  open, anchor, onClose, className = "", label, children,
}: {
  open: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    /* `capture`, because the scroll that moves the anchor is the dashboard body's, not
       the window's. */
    window.addEventListener("scroll", place, true);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div className="sheet-veil" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{ "--pop-top": `${pos.top}px`, "--pop-right": `${pos.right}px` } as React.CSSProperties}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
