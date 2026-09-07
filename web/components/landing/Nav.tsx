"use client";

import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { WalletMenu } from "@/components/WalletMenu";
import { Wordmark } from "@/components/Wordmark";
import { LpButton } from "./Button";

/**
 * The template's navbar — a floating pill, links beside the mark, actions on the
 * right — carrying our links and our wallet instead of Login / Sign Up.
 *
 * The wallet button is a convenience, never a gate: this page renders everything it
 * has with or without a connection.
 *
 * The template slid the bar in from above with a motion library and read scroll
 * position through another hook. Here the bar is simply there, and the scrolled
 * state is one attribute watchScroll already sets on the root.
 *
 * Below `lg` the links live in a native <details> overlay — no state, no listener,
 * usable before hydration. The only script is the one that closes it after a link
 * on the same page is chosen, which a hash navigation would otherwise leave open.
 */
const LINKS = [
  { href: "/auctions", label: "Auctions" },
  { href: "/#how", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/#faq", label: "FAQ" },
];
const GITHUB = "https://github.com/Vickrey-Protocol/vickrey";

const LINK =
  "tw:inline-flex tw:items-center tw:rounded-md tw:px-4 tw:py-2 tw:text-sm tw:leading-[110%] " +
  "tw:text-neutral-600 tw:no-underline tw:transition tw:duration-200 tw:hover:bg-neutral-100 tw:hover:text-black";
const SHEET_LINK =
  "tw:inline-flex tw:min-h-11 tw:items-center tw:text-2xl tw:text-black tw:no-underline";

function closeSheet(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.closest("details")?.removeAttribute("open");
}

export function Nav() {
  const { connection, connect, connecting, reconnecting } = useWallet();

  const wallet = connection ? (
    <>
      <Link href="/app" className={LINK}>Dashboard</Link>
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
    <nav className="lp-nav tw:fixed tw:inset-x-0 tw:top-4 tw:z-50 tw:mx-auto tw:w-[95%] tw:max-w-7xl" aria-label="Site">
      <div className="lp-nav-bar tw:relative tw:flex tw:items-center tw:justify-between tw:rounded-full tw:px-3 tw:py-2 tw:transition tw:duration-200">
        <div className="tw:flex tw:items-center tw:gap-2">
          <Wordmark size={20} className="tw:px-2" />
          <div className="tw:hidden tw:items-center tw:gap-1 tw:lg:flex">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}
            <a href={GITHUB} target="_blank" rel="noreferrer" className={LINK}>GitHub</a>
          </div>
        </div>

        <div className="tw:hidden tw:items-center tw:gap-2 tw:lg:flex">{wallet}</div>

        <details className="lp-menu tw:lg:hidden">
          <summary
            className="tw:flex tw:size-11 tw:cursor-pointer tw:list-none tw:items-center tw:justify-center tw:rounded-full tw:hover:bg-neutral-100"
            aria-label="Menu"
          >
            <svg className="lp-burger" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <svg className="lp-x" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </summary>
          <div className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:flex-col tw:gap-8 tw:bg-white tw:px-6 tw:pt-5">
            <div className="tw:flex tw:h-11 tw:items-center"><Wordmark size={20} /></div>
            <div className="tw:flex tw:flex-col tw:gap-2">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={SHEET_LINK} onClick={closeSheet}>{l.label}</Link>
              ))}
              <a href={GITHUB} target="_blank" rel="noreferrer" className={SHEET_LINK}>GitHub ↗</a>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">{wallet}</div>
          </div>
        </details>
      </div>
    </nav>
  );
}
