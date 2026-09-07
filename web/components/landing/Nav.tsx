"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { WalletMenu } from "@/components/WalletMenu";
import { Wordmark } from "@/components/Wordmark";
import { LpButton } from "./Button";

/**
 * The template's navbar, to the letter, without its library.
 *
 *   · It slides in from above on load: `motion.nav initial={{y:-80}}` over .8s with
 *     the template's ease. Here that is a keyframe on `.lp-nav`, run only under
 *     `[data-motion="play"]` — with no script the bar is simply there.
 *   · Past 100px of scroll the pill takes a ground and a hairline shadow, and a masked
 *     neutral layer fades in over a second. The template read scroll through a hook;
 *     this is one passive listener.
 *   · A soft pill follows the hovered link and rests on the active route. The template
 *     did that with `layoutId` and a spring; this is one element whose left and width
 *     are set from the hovered link and transitioned in CSS.
 *
 * Content is ours: our links, our wallet where Login / Sign Up stood.
 * Below `lg` the links live in a native <details> overlay — no state, usable before
 * hydration; the summary rises above its own sheet and becomes the close control.
 */
const LINKS = [
  { href: "/auctions", label: "Auctions" },
  { href: "/#how", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/#faq", label: "FAQ" },
  { href: "https://github.com/Vickrey-Protocol/vickrey", label: "GitHub", external: true },
];

const ITEM =
  "tw:relative tw:z-10 tw:flex tw:items-center tw:justify-center tw:rounded-md tw:px-4 tw:py-2 tw:text-sm tw:leading-[110%] " +
  "tw:text-neutral-600 tw:no-underline tw:hover:text-black";
const SHEET_LINK = "tw:inline-flex tw:min-h-11 tw:items-center tw:text-2xl tw:text-black tw:no-underline";

function closeSheet(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.closest("details")?.removeAttribute("open");
}

export function Nav() {
  const { connection, connect, connecting, reconnecting } = useWallet();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 100);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  /* The pill sits under the hovered link, or under the active route when nothing is
     hovered — the template's `hovered === null && pathname.includes(link)`. */
  const route = (href: string) => href.split("#")[0] || "/";
  const active = LINKS.find((l) => !l.external && route(l.href) !== "/" && pathname?.startsWith(route(l.href)))?.href ?? null;
  const target = hover ?? active;
  useEffect(() => {
    const el = target ? list.current?.querySelector<HTMLElement>(`[data-href="${CSS.escape(target)}"]`) : null;
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [target]);

  const wallet = connection ? (
    <>
      <Link href="/app" className={ITEM}>Dashboard</Link>
      <WalletMenu />
    </>
  ) : reconnecting ? (
    <span className="pill sealed" aria-live="polite">Reconnecting…</span>
  ) : (
    <LpButton onClick={() => void connect("/app")} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </LpButton>
  );

  return (
    <nav
      data-beat="nav" data-beat-prop="ty"
      className="lp-nav tw:fixed tw:inset-x-0 tw:top-4 tw:z-50 tw:mx-auto tw:w-[95%] tw:max-w-7xl tw:lg:w-full"
      aria-label="Site"
    >
      <div
        className={
          "lp-nav-bar tw:relative tw:flex tw:w-full tw:justify-between tw:rounded-full tw:px-4 tw:py-2 tw:transition tw:duration-200 " +
          (scrolled ? "tw:bg-neutral-50 tw:shadow-[0px_-2px_0px_0px_#f5f5f5,0px_2px_0px_0px_#f5f5f5]" : "tw:bg-transparent")
        }
      >
        {scrolled && (
          <div className="lp-nav-glow tw:pointer-events-none tw:absolute tw:inset-0 tw:h-full tw:w-full tw:rounded-full tw:bg-neutral-100 tw:[mask-image:linear-gradient(to_bottom,white,transparent,white)]" />
        )}

        <div className="tw:flex tw:flex-row tw:items-center tw:gap-2">
          <Wordmark size={20} className="tw:relative tw:z-20 tw:mr-4 tw:px-2 tw:py-1" />
          <div ref={list} className="tw:relative tw:hidden tw:items-center tw:gap-1.5 tw:lg:flex" onMouseLeave={() => setHover(null)}>
            {pill && (
              <div className="lp-nav-pill tw:absolute tw:inset-y-0 tw:rounded-md tw:bg-[#F5F5F5]" style={{ left: pill.left, width: pill.width }} aria-hidden="true" />
            )}
            {LINKS.map((l) =>
              l.external ? (
                <a key={l.href} href={l.href} target="_blank" rel="noreferrer" data-href={l.href} className={ITEM} onMouseEnter={() => setHover(l.href)}>{l.label}</a>
              ) : (
                <Link key={l.href} href={l.href} data-href={l.href} className={ITEM + (active === l.href ? " tw:text-black" : "")} onMouseEnter={() => setHover(l.href)}>{l.label}</Link>
              ),
            )}
          </div>
        </div>

        <div className="tw:hidden tw:items-center tw:space-x-2 tw:lg:flex">{wallet}</div>

        <details className="lp-menu tw:lg:hidden">
          <summary
            className="tw:flex tw:size-11 tw:cursor-pointer tw:list-none tw:items-center tw:justify-center tw:rounded-full tw:hover:bg-neutral-100"
            aria-label="Menu"
          >
            <svg className="lp-burger" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            <svg className="lp-x" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </summary>
          <div className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:flex-col tw:items-start tw:justify-start tw:gap-10 tw:bg-white tw:px-5 tw:pt-5 tw:text-xl">
            <div className="tw:flex tw:h-11 tw:items-center"><Wordmark size={20} /></div>
            <div className="tw:flex tw:flex-col tw:items-start tw:justify-start tw:gap-3.5 tw:px-3">
              {LINKS.map((l) =>
                l.external
                  ? <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={SHEET_LINK}>{l.label} ↗</a>
                  : <Link key={l.href} href={l.href} className={SHEET_LINK} onClick={closeSheet}>{l.label}</Link>,
              )}
            </div>
            <div className="tw:flex tw:w-full tw:flex-row tw:flex-wrap tw:items-start tw:gap-2.5 tw:px-3 tw:py-4">{wallet}</div>
          </div>
        </details>
      </div>
    </nav>
  );
}
