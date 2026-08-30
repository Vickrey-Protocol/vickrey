"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { config, explorerContract, shortAddr } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";

/**
 * The connected-wallet button, and the only way out.
 *
 * There was no disconnect anywhere: the masthead pill navigated to the dashboard and the
 * dashboard chip disconnected on a single click with no confirmation and no explanation
 * of the `×`. Neither is a control anyone would find on purpose.
 *
 * Disconnecting also has to move you somewhere that works without a wallet. Clearing the
 * connection while the user is standing on `/app/create` leaves them looking at a form
 * that cannot submit, which reads as a crash rather than as the thing they just asked
 * for.
 */
export function WalletMenu({ compact = false }: { compact?: boolean }) {
  const { connection, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const path = usePathname();

  if (!connection) return null;

  const leave = () => {
    setOpen(false);
    disconnect();                       // also clears the remembered wallet
    // Everything under /app needs a wallet; the public routes do not.
    if (path.startsWith("/app")) router.push("/auctions");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connection.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked; the address is on screen to select by hand */ }
  };

  return (
    <>
      <button
        className={compact ? "chip" : "pill sealed"}
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {shortAddr(connection.address)}
        {!connection.strk20 && " · no strk20"}
        <span aria-hidden="true" style={{ marginInlineStart: ".4rem", opacity: .7 }}>▾</span>
      </button>

      {open && (
        <div className="picker-veil" onClick={() => setOpen(false)}>
          <div className="picker" role="menu" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">{connection.walletName}</p>
            <p className="mono" style={{ margin: ".5rem 0 0", fontSize: ".82rem",
                                         wordBreak: "break-all", color: "var(--ink-2)" }}>
              {connection.address}
            </p>
            <p className="note" style={{ marginTop: ".5rem" }}>
              On {config.label}
              {connection.strk20 ? "" : " · this wallet reports no STRK20 support"}
            </p>

            <div className="stack" style={{ gap: ".5rem", marginTop: "1.1rem" }}>
              <button onClick={() => void copy()}>{copied ? "Copied" : "Copy address"}</button>
              <a href={explorerContract(connection.address)} target="_blank" rel="noreferrer"
                 onClick={() => setOpen(false)}>View on the explorer ↗</a>
              <button onClick={leave}>Disconnect</button>
            </div>
            <p className="note" style={{ marginTop: ".8rem" }}>
              Disconnecting is remembered — you will not be signed back in on reload.
              Your claim secrets stay in this browser either way.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
