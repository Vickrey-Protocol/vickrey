"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { WalletMenu } from "@/components/WalletMenu";
import { Notifications } from "@/components/Notifications";
import { NavSheet } from "@/components/NavSheet";
import { bidderActions, type DueAction } from "@/lib/actions";

/**
 * The dashboard chrome: fixed sidebar, topbar, content.
 *
 * Unlike the public routes this one *is* gated — everything it frames moves money. The
 * gate is a prompt, not a wall with no way through: it says what the dashboard is for
 * and links back to the public auctions, because a visitor without a wallet can still
 * see every auction and every proof.
 */
export function DashShell({
  title, actions = [], ownsAuctions = false, children,
}: {
  title: string;
  /**
   * The whole queue rather than a count. The bell needs every field to render an entry,
   * and the sidebar badge needs to filter by role — it hung off "My bids" while counting
   * the auctioneer's work too, so an address holding no bids could read "My bids 2".
   */
  actions?: DueAction[];
  ownsAuctions?: boolean;
  children: React.ReactNode;
}) {
  const { connection, connect, connecting, reconnecting, error } = useWallet();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const myBids = bidderActions(actions).length;
  const on = (href: string) => path === href || (href !== "/app" && path.startsWith(href));

  /* Wait for the silent reconnect before deciding this is a logged-out visitor —
     otherwise a reload of the dashboard shows "Connect to act" and then replaces it. */
  if (!connection && reconnecting) {
    return (
      <main>
        <div className="backdrop" aria-hidden="true" />
        <div className="panel" style={{ maxWidth: "52ch", margin: "5rem auto" }}>
          <p className="eyebrow">Dashboard</p>
          <p className="note" style={{ marginTop: ".6rem" }} aria-live="polite">
            Reconnecting to your wallet…
          </p>
        </div>
      </main>
    );
  }

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

  /* One definition, rendered twice: in the sidebar at 1024px and up, and inside the
     slide-in panel below it. Two copies would drift, and the one that drifts is always
     the one fewer people look at. */
  const navLinks = (
    <>
      <Link href="/app" className={on("/app") && path === "/app" ? "here" : ""}>Overview</Link>
      <Link href="/app/auctions" className={on("/app/auctions") ? "here" : ""}>Auctions</Link>
      <Link href="/app/bids" className={on("/app/bids") ? "here" : ""}>
        My bids
        {/* Bid-side only. Counting the auctioneer's steps here put a number on a noun it
            did not describe, and the page underneath then correctly showed no bids — two
            true statements that read as a contradiction. */}
        {myBids > 0 && <span className="due">{myBids}</span>}
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
    </>
  );

  return (
    <div className="dash">
      <aside className="dash-side">
        <Link href="/" className="wordmark" style={{ textDecoration: "none" }}>
          Vickrey<span aria-hidden="true" />
        </Link>

        <nav className="dash-nav" aria-label="Dashboard">{navLinks}</nav>
      </aside>

      <div className="dash-main">
        <header className="dash-top">
          <div className="dash-burger">
            <NavSheet open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)}
                      label="Dashboard navigation">
              <nav className="navsheet-nav dash-nav" aria-label="Dashboard">{navLinks}</nav>
            </NavSheet>
          </div>
          <h1 className="dash-title">{title}</h1>
          {/* Obligations, then account. Both belong to the session rather than to the
              page, and both were previously somewhere else: the count was a pill that
              navigated to a list, and the account sat under the sidebar navigation. */}
          <div className="dash-controls">
            <Notifications actions={actions} />
            <WalletMenu />
          </div>
        </header>
        <div className="dash-body">{children}</div>
      </div>
    </div>
  );
}
