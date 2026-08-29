"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { config, shortAddr } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";
import { Balances } from "@/components/Balances";

/**
 * The dashboard chrome: fixed sidebar, topbar, content.
 *
 * Unlike the public routes this one *is* gated — everything it frames moves money. The
 * gate is a prompt, not a wall with no way through: it says what the dashboard is for
 * and links back to the public auctions, because a visitor without a wallet can still
 * see every auction and every proof.
 */
export function DashShell({
  title, actionsDue = 0, ownsAuctions = false, children,
}: {
  title: string;
  actionsDue?: number;
  ownsAuctions?: boolean;
  children: React.ReactNode;
}) {
  const { connection, connect, connecting, disconnect, error } = useWallet();
  const path = usePathname();
  const on = (href: string) => path === href || (href !== "/app" && path.startsWith(href));

  if (!connection) {
    return (
      <main>
        <div className="backdrop" aria-hidden="true" />
        <div className="panel" style={{ maxWidth: "52ch", margin: "5rem auto" }}>
          <p className="eyebrow">Dashboard</p>
          <h1 className="display" style={{ fontSize: "var(--step-3)", marginTop: ".4rem" }}>
            Connect to act
          </h1>
          <p style={{ marginTop: ".9rem" }}>
            Bidding, sealing, settling and claiming need a wallet. Reading does not —
            every auction, every proof and every clearing price is public.
          </p>
          {error && <p className="err" style={{ marginTop: ".8rem" }}>{error}</p>}
          <div className="row" style={{ gap: ".6rem", marginTop: "1.2rem" }}>
            <button className="primary" onClick={() => void connect()} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <Link href="/auctions">Browse auctions instead</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="dash">
      <aside className="dash-side">
        <Link href="/" className="wordmark" style={{ textDecoration: "none" }}>
          Vickrey<span aria-hidden="true" />
        </Link>

        <nav className="dash-nav" aria-label="Dashboard">
          <Link href="/app" className={on("/app") && path === "/app" ? "here" : ""}>Overview</Link>
          <Link href="/app/auctions" className={on("/app/auctions") ? "here" : ""}>Auctions</Link>
          <Link href="/app/bids" className={on("/app/bids") ? "here" : ""}>
            My bids
            {/* The most important element in the sidebar: what will cost you money. */}
            {actionsDue > 0 && <span className="due">{actionsDue}</span>}
          </Link>
          <Link href="/app/create" className={on("/app/create") ? "here" : ""}>Create auction</Link>

          {/* Rendered only when it has contents — an empty group is furniture. */}
          {ownsAuctions && (
            <>
              <hr />
              <p className="dash-group">Auctioneer</p>
              <Link href="/app/manage" className={on("/app/manage") ? "here" : ""}>Manage</Link>
            </>
          )}

          <hr />
          <Link href="/docs">Docs</Link>
          <Link href="/auctions">Public site</Link>
          <a href="https://github.com/Vickrey-Protocol/vickrey" target="_blank" rel="noreferrer">GitHub</a>
        </nav>

        <div className="dash-foot">
          <span className="badge">{config.label}</span>
          <button className="chip" onClick={disconnect} title="Disconnect">
            {shortAddr(connection.address)} ×
          </button>
          {!connection.strk20 && (
            <p className="note" style={{ marginTop: ".5rem" }}>
              This wallet reports no STRK20 support. Public-rail bidding still works; the
              private rail needs a pool-capable wallet.
            </p>
          )}
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-top">
          <h1 className="dash-title">{title}</h1>
          <div className="row" style={{ gap: ".9rem" }}>
            <Balances />
            {actionsDue > 0 && (
              <Link href="/app" className="pill open" style={{ textDecoration: "none" }}>
                {actionsDue} need{actionsDue === 1 ? "s" : ""} you
              </Link>
            )}
            <span className="badge">{config.label}</span>
          </div>
        </header>
        <div className="dash-body">{children}</div>
      </div>
    </div>
  );
}
