"use client";

import { useEffect, useId, useRef } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

/**
 * The narrow-screen navigation panel, and the button that opens it.
 *
 * A slide-in rather than a dropdown because the thing being replaced is a whole
 * navigation region, not a menu of one control's options: on the public site it holds
 * five links and the wallet, on the dashboard the entire sidebar. A dropdown that tall
 * is a list hanging off a header; a panel is a place.
 *
 * Portalled for the same reason the account panel is — `.dash-top` carries a
 * `backdrop-filter`, and a filter makes an element the containing block for every
 * `position: fixed` descendant, so a full-height panel written inside the bar would be
 * clipped to the height of the bar.
 *
 * Four ways out, because a panel that covers the screen and traps you is worse than no
 * panel: Escape, the backdrop, the close button, and navigating — the last one matters
 * most, since every link inside it leads somewhere and none of them would otherwise
 * dismiss it.
 */
export function NavSheet({
  open, onOpen, onClose, label, children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const id = useId();

  /* Navigation closes it. Next keeps this component mounted across a route change, so
     without this the panel stays open over the page it just took you to. */
  useEffect(() => { if (open) onClose(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [path]);

  useEffect(() => {
    if (!open) return;

    /* The page behind must not scroll under the panel. Restoring the previous value
       rather than clearing it, so this composes with anything else that locks. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      /* Focus stays inside while it is modal. Queried per keystroke because the panel's
         contents change — the wallet button becomes an address once connected. */
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      <button
        ref={opener}
        className="burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {/* Three bars that become a cross. The shape carries the state, so the control
            does not depend on colour or on a label nobody reads twice. */}
        <span className={`burger-box${open ? " x" : ""}`} aria-hidden="true">
          <i /><i /><i />
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="navsheet-veil" onClick={onClose} aria-hidden="true" />
          <div
            id={id}
            ref={panel}
            className="navsheet"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
          >
            <div className="navsheet-top">
              <span className="wordmark">Vickrey<span aria-hidden="true" /></span>
              <button className="sheet-x" onClick={onClose} aria-label="Close menu">×</button>
            </div>
            <div className="navsheet-body">{children}</div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
