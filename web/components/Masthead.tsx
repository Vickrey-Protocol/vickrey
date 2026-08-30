"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { WalletMenu } from "@/components/WalletMenu";
import { NavSheet } from "@/components/NavSheet";
import { Wordmark } from "@/components/Wordmark";

/**
 * The public-site header. Its wallet button is a convenience, never a gate — every
 * route that renders this masthead renders its evidence with or without a connection.
 *
 * Below 1024px the links move into a slide-in panel and the bar keeps one row: wordmark
 * and the button that opens it. What it replaced was the desktop arrangement folded up —
 * wordmark and network chip, then the wallet button, then the links as a cramped inline
 * strip, three rows deep before any content began.
 *
 * The network chip is gone from here entirely. It only ever named the build's own target,
 * which is not a question anyone has; whether *your wallet* agrees is, and that lives in
 * the account panel where both halves can sit together. The footer still names the
 * network for a visitor who has not connected anything.
 */
const LINKS = [
  { href: "/auctions", label: "Auctions" },
  /* Two audiences. The anchor is the ninety-second version on the landing page; Docs is
     the reference. Pointing both at the same place meant whoever wanted an overview got
     a wall, and whoever wanted the reference never learned it existed. */
  { href: "/#how", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/#faq", label: "FAQ" },
];

const GITHUB = "https://github.com/Vickrey-Protocol/vickrey";

export function Masthead() {
  const { connection, connect, connecting, reconnecting } = useWallet();
  const [menu, setMenu] = useState(false);

  const wallet = (
    connection ? (
      <>
        <Link href="/app" className="note">Dashboard</Link>
        <WalletMenu />
      </>
    ) : reconnecting ? (
      /* A wallet we were authorised on is being re-attached. Showing the button here and
         swapping it for an address a moment later is the flash this avoids. */
      <span className="pill sealed" aria-live="polite">Reconnecting…</span>
    ) : (
      <button className="primary" onClick={() => void connect("/app")} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    )
  );

  return (
    <header className="masthead">
      <Wordmark />

      <nav className="nav" aria-label="Sections">
        {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <div className="row masthead-wallet">{wallet}</div>

      <div className="masthead-burger">
        <NavSheet open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)}
                  label="Site navigation">
          <nav className="navsheet-nav" aria-label="Sections">
            {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub ↗</a>
          </nav>
          {/* Inside the panel rather than in the bar: at 360px a third control makes the
              row cramped, and the panel gives the primary action its full width. */}
          <div className="navsheet-wallet">{wallet}</div>
        </NavSheet>
      </div>
    </header>
  );
}
