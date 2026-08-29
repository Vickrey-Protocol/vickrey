"use client";

import Link from "next/link";
import { config, shortAddr } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";

/**
 * The public-site header. Its wallet button is a convenience, never a gate — every
 * route that renders this masthead renders its evidence with or without a connection.
 */
export function Masthead() {
  const { connection, connect, connecting } = useWallet();
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
        <Link href="/docs">How it works</Link>
        <Link href="/#faq">FAQ</Link>
        <a href="https://github.com/Vickrey-Protocol/vickrey" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div className="row">
        {connection ? (
          <Link href="/app" className="pill sealed" style={{ textDecoration: "none" }}>
            {shortAddr(connection.address)}{connection.strk20 ? "" : " · no strk20"}
          </Link>
        ) : (
          <button className="primary" onClick={() => void connect("/app")} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
