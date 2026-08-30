"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  STRK_DECIMALS, config, explorerContract, formatUnits, shortAddr,
} from "@/lib/config";
import { CHAIN_ID, chainName, useWallet } from "@/components/WalletProvider";
import { PublicBalance } from "@/components/Balances";
import { Popover } from "@/components/Popover";

/**
 * The account panel: who you are, where you are, what you can spend, and the way out.
 *
 * It moved into the topbar because everything it holds belongs to the session rather
 * than to the page. It had appeared at the bottom of the sidebar, below the navigation,
 * which is where a product puts things it has not decided what to do with.
 *
 * **Network lives here now**, and the two standalone "Sepolia (rehearsal)" chips are
 * gone. A chip that only ever names the build's own target is decoration; the question a
 * user actually has is whether their *wallet* agrees with it, and that needs both halves
 * side by side.
 *
 * There is deliberately no free network switch. Contract addresses are compile-time
 * (`NEXT_PUBLIC_AUCTION_ADDRESS`), so this build reads exactly one network, and a
 * chooser offering the other would be a control that breaks the app it sits in.
 * Switching is offered only to resolve a disagreement, which is the one case where it
 * fixes something.
 */
export function WalletMenu() {
  const {
    connection, disconnect, walletChain, switchChain, switching, strk20Proof,
  } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const path = usePathname();

  const close = useCallback(() => { setOpen(false); btn.current?.focus(); }, []);

  if (!connection) return null;

  /* Null means the wallet would not say, which is not a mismatch — some wallets simply
     do not answer, and calling that "wrong network" would be a false alarm. */
  const agrees = walletChain === null || walletChain === CHAIN_ID[config.network];

  const leave = () => {
    setOpen(false);
    disconnect();                       // also clears the remembered wallet
    // Everything under /app needs a wallet; the public routes do not. Clearing the
    // connection under a form that can no longer submit reads as a crash.
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
    <div className="acct-wrap">
      <button
        ref={btn}
        className={`acct${open ? " on" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`acct-dot${agrees ? "" : " bad"}`} aria-hidden="true" />
        <span className="acct-addr">{shortAddr(connection.address)}</span>
        <span aria-hidden="true" className="acct-caret">▾</span>
      </button>

      <Popover open={open} anchor={btn} onClose={close} className="acct-sheet" label="Wallet">
            <header className="sheet-top">
              <div>
                <p className="eyebrow">{connection.walletName}</p>
                <p className="acct-full mono">{connection.address}</p>
              </div>
              <button className="sheet-x" onClick={close} aria-label="Close">×</button>
            </header>

            <div className="acct-body">
              <section className="acct-row">
                <p className="acct-lab">Network</p>
                <div className="acct-net">
                  <span className={`acct-dot${agrees ? "" : " bad"}`} aria-hidden="true" />
                  <b>{config.label}</b>
                </div>
                {agrees ? (
                  <p className="note">
                    {walletChain === null
                      ? "Your wallet does not report its network. Nothing is blocked; it will refuse itself if it disagrees."
                      : "Your wallet is on the same network."}
                  </p>
                ) : (
                  <>
                    <p className="note">
                      Your wallet is on <b>{chainName(walletChain)}</b>. This build reads
                      one network — its contract addresses are fixed at build time — so
                      the wallet is the side that moves.
                    </p>
                    <button className="primary" onClick={() => void switchChain()}
                            disabled={switching} style={{ marginTop: ".6rem" }}>
                      {switching ? "Asking the wallet…" : `Switch to ${config.label}`}
                    </button>
                  </>
                )}
              </section>

              <section className="acct-row">
                <p className="acct-lab">Balances</p>
                <Balances />
              </section>

              <section className="acct-row acct-actions">
                <button onClick={() => void copy()}>{copied ? "Copied" : "Copy address"}</button>
                <a href={explorerContract(connection.address)} target="_blank" rel="noreferrer"
                   onClick={close}>View on the explorer ↗</a>
                <button className="acct-out" onClick={leave}>Disconnect</button>
              </section>

              <p className="note acct-foot">
                Disconnecting is remembered — you will not be signed back in on reload.
                Your claim secrets stay in this browser either way.
              </p>
              {!connection.strk20Declared && (
                <p className="note">
                  This wallet does not advertise STRK20 support. Public-rail bidding still
                  works; the private rail needs a pool-capable wallet.
                </p>
              )}
              {connection.strk20Declared && strk20Proof === "failed" && (
                /* The distinction the flag could not make. The wallet advertises the
                   interface and a real call to it failed, so saying "supported" here
                   would repeat the mistake that produced the bare UNKNOWN_ERROR. */
                <p className="note">
                  This wallet advertises STRK20, but a real pool read on {config.label}{" "}
                  did not work. Public-rail bidding is unaffected.
                </p>
              )}
            </div>
      </Popover>
    </div>
  );
}

/**
 * Public and shielded, side by side, because the pair is the point.
 *
 * The public figure is a plain ERC-20 read and answers "can I cover the escrow". The
 * shielded one answers the same question for the private rail, and until now could not
 * be answered at all — a bidder found out by watching the transaction fail.
 */
function Balances() {
  const { shielded, shieldedPending, shieldedErr, requestShielded } = useWallet();

  return (
    <>
      <div className="acct-bal">
        <div>
          <p className="acct-bal-lab">Public</p>
          <PublicBalance />
        </div>
        <div>
          <p className="acct-bal-lab">Shielded</p>
          <p className="acct-bal-num">
            {shielded === null
              ? <span className="undisclosed">not requested</span>
              : `${formatUnits(shielded, STRK_DECIMALS, 4)} STRK`}
          </p>
        </div>
      </div>

      {shielded === null && (
        <div className="acct-optin">
          <p className="note">
            This app has not asked for it. Your wallet holds the viewing key and answers
            with a figure — the key itself never reaches this page, which is why the
            private rail works without one being handed over.
          </p>
          <button onClick={() => void requestShielded()} disabled={shieldedPending}>
            {shieldedPending ? "Asking your wallet…" : "Show shielded balance"}
          </button>
          <p className="note">
            Reads your <b>whole-account</b> shielded balance into this page for this
            session only. Never scoped to one auction, never sent anywhere, and gone on
            reload.
          </p>
        </div>
      )}
      {shieldedErr && <p className="err">{shieldedErr}</p>}
    </>
  );
}
