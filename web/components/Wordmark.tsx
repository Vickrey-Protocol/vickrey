"use client";

import Link from "next/link";

/**
 * Mark and wordmark, in one place because they appear in two.
 *
 * The wordmark used to end in a small accent dot standing in for a mark we had but were
 * not using. Now that the real one is here the dot is gone rather than kept beside it —
 * two marks next to each other is one more than a lockup needs, and the dot was only
 * ever a placeholder for this.
 *
 * No subtitle. The lockup is the mark and the name.
 */
export function Wordmark({
  href = "/", size = 22, className = "",
}: {
  /** Omit to render a plain span — the dashboard header is not a link to itself. */
  href?: string | null;
  size?: number;
  className?: string;
}) {
  const inner = (
    <>
      {/* Decorative: the word beside it is the accessible name, so announcing "Vickrey"
          twice would be the only thing this added. */}
      <img src="/mark.png" alt="" aria-hidden="true" width={size} height={size}
           className="wordmark-mark" />
      <span className="wordmark-text">Vickrey</span>
    </>
  );

  const cls = `wordmark ${className}`.trim();
  return href
    ? <Link href={href} className={cls} style={{ textDecoration: "none" }}>{inner}</Link>
    : <span className={cls}>{inner}</span>;
}
