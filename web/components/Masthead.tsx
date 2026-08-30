"use client";

import Link from "next/link";
import { config, shortAddr } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";
import { WalletMenu } from "@/components/WalletMenu";

/**
 * The public-site header. Its wallet button is a convenience, never a gate — every
 * route that renders this masthead renders its evidence with or without a connection.
 */
export function Masthead() {
  const { connection, connect, connecting, reconnecting } = useWallet();
  return (
    <header className="masthead">
      <div className="row" style={{ gap: ".7rem" }}>
        <Link href="/" className="wordmark" style={{ textDecoration: "none" }}>
          Vickrey<span aria-hidden="true" />
        </Link>
        <span className="badge">{config.label}</span>
      </div>
      <nav className="nav" aria-label="Sections">
        <Link href="/auctions">Auctions</Link>
        {/* Two audiences. The anchor is the ninety-second version on the landing page;
            Docs is the reference. Pointing both at the same place meant whoever wanted
            an overview got a wall, and whoever wanted the reference never learned it
            existed. */}
        <Link href="/#how">How it works</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/#faq">FAQ</Link>
        <a href="https://github.com/Vickrey-Protocol/vickrey" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div className="row">
        {connection ? (
          <div className="row" style={{ gap: ".5rem" }}>
            <Link href="/app" className="note">Dashboard</Link>
            <WalletMenu />
          </div>
        ) : reconnecting ? (
          /* A wallet we were authorised on is being re-attached. Showing the button here
             and swapping it for an address a moment later is the flash this avoids. */
          <span className="pill sealed" aria-live="polite">Reconnecting…</span>
        ) : (
          <button className="primary" onClick={() => void connect("/app")} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
