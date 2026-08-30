"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import { compareVersions, shortString, walletV6 } from "starknet";
import { config } from "@/lib/config";
import { availableWallets, connect as connectWallet, type Connection } from "@/lib/wallet";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

/**
 * Wallet state, shared across routes.
 *
 * The restructure puts the same connection behind eight routes, and the public ones
 * need to know about it without depending on it — a public auction page renders its
 * evidence whether or not this holds a connection, and only *adds* the action column
 * when it does. Context rather than prop drilling because the masthead and the page
 * body both read it, and they are not in the same subtree.
 *
 * Nothing here auto-connects. A page load must never pop a wallet prompt: a judge
 * opening the site to check a claim has not asked to be asked.
 */
const CHAIN_ID = {
  mainnet: "0x534e5f4d41494e",
  sepolia: "0x534e5f5345504f4c4941",
} as const;
const chainName = (id: string | null) => {
  if (!id) return "unknown";
  try { return shortString.decodeShortString(id); } catch { return id; }
};

interface WalletState {
  connection: Connection | null;
  error: string | null;
  connecting: boolean;
  /**
   * Opens the picker. Never connects to a wallet the user did not name.
   *
   * `goTo` is where to land once a wallet is chosen. The landing page passes `/app`,
   * because connecting there has no other visible effect — the button turned into an
   * address and the user stayed on a marketing page, with the route to the dashboard
   * hidden behind clicking that same address again. Nobody finds that.
   *
   * An auction page passes nothing: connecting there reveals the bid panel in place, and
   * navigating away would lose the auction the user was looking at.
   */
  connect: (goTo?: string) => Promise<void>;
  disconnect: () => void;
  /**
   * Confirms the wallet is on the network this app reads, and blocks if not.
   *
   * Every signing path calls this first. Without it the wallet throws its own error —
   * "Cannot sign the message from a different chainId. Expected 0x534e5f5345504f4c4941,
   * got 0x534e5f4d41494e" — accurate, unreadable, and arriving only after the user has
   * committed to the action. A mid-session network switch hits every button in the app,
   * so the check belongs here rather than on whichever form happened to find it.
   */
  ensureChain: () => Promise<boolean>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [choices, setChoices] = useState<WalletWithStarknetFeatures[] | null>(null);

  /**
   * Opens the picker rather than connecting.
   *
   * This used to take `wallets[0]` and open whatever that happened to be — which on a
   * machine with three extensions installed meant a prompt from a wallet the user had
   * not chosen, and a whole page of results describing the wrong one. With three
   * wallets detected and the pool leg riding on *which* one holds the shielded balance,
   * picking silently is the wrong default even when it guesses right.
   */
  const [wrongChain, setWrongChain] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const goToRef = useRef<string | null>(null);

  const readChain = useCallback(async (): Promise<string | null> => {
    try {
      const found = await availableWallets();
      const w = found.find((x) => x.name === connection?.walletName) ?? found[0];
      return w ? await walletV6.requestChainId(w as never) : null;
    } catch { return null; }
  }, [connection?.walletName]);

  const ensureChain = useCallback(async () => {
    if (!connection) return false;
    const id = await readChain();
    /* A wallet that will not say which chain it is on is not grounds for blocking —
       let it through and let the wallet refuse if it must. Guessing "mismatch" from a
       failed read would break signing for wallets that simply do not answer. */
    if (!id) return true;
    if (id === CHAIN_ID[config.network]) { setWrongChain(null); return true; }
    setWrongChain(id);
    return false;
  }, [connection, readChain]);

  const switchChain = useCallback(async () => {
    setSwitching(true);
    try {
      const found = await availableWallets();
      const w = found.find((x) => x.name === connection?.walletName) ?? found[0];
      if (w) await walletV6.switchStarknetChain(w as never, CHAIN_ID[config.network]);
      const id = await readChain();
      if (!id || id === CHAIN_ID[config.network]) setWrongChain(null);
    } catch { /* the banner stays up; the wallet refused */ }
    finally { setSwitching(false); }
  }, [connection?.walletName, readChain]);

  const connect = useCallback(async (goTo?: string) => {
    goToRef.current = goTo ?? null;
    setError(null);
    try {
      const found = await availableWallets();
      if (found.length === 0) {
        setError("No Starknet wallet detected in this browser.");
        return;
      }
      setChoices(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const choose = useCallback(async (w: WalletWithStarknetFeatures) => {
    setChoices(null);
    setConnecting(true);
    setError(null);
    try {
      const c = await connectWallet(w);
      setConnection(c);
      // Checked on connect too, so the mismatch is visible before anything is attempted.
      const id = await readChain();
      if (id && id !== CHAIN_ID[config.network]) setWrongChain(id);
      if (goToRef.current) { const to = goToRef.current; goToRef.current = null; router.push(to); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnection(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ connection, error, connecting, connect, disconnect, ensureChain }),
    [connection, error, connecting, connect, disconnect, ensureChain],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {wrongChain && (
        <div className="picker-veil" role="alertdialog" aria-modal="true"
             aria-label="Wrong network">
          <div className="picker">
            <p className="eyebrow">Wrong network</p>
            <p style={{ margin: ".5rem 0 0" }}>
              This app is reading <b>{config.label}</b>. Your wallet is on{" "}
              <b>{chainName(wrongChain)}</b>.
            </p>
            <p className="note" style={{ marginTop: ".5rem" }}>
              Nothing has been signed. Signing from the wrong network fails inside the
              wallet after you have approved it, which is a worse place to find out.
            </p>
            <div className="row" style={{ gap: ".6rem", marginTop: "1.1rem" }}>
              <button className="primary" onClick={() => void switchChain()} disabled={switching}>
                {switching ? "Asking the wallet…" : `Switch to ${config.label}`}
              </button>
              <button onClick={() => setWrongChain(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
      {choices && (
        <div className="picker-veil" role="dialog" aria-modal="true" aria-label="Choose a wallet"
             onClick={() => setChoices(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Choose a wallet</p>
            <p className="note" style={{ margin: ".4rem 0 1rem" }}>
              {choices.length} detected. The one you pick is the one that must hold your
              shielded balance.
            </p>
            <div className="stack" style={{ gap: ".5rem" }}>
              {choices.map((w) => (
                <button key={w.name} className="rail" onClick={() => void choose(w)}>
                  <span className="rail-name">{w.name}</span>
                  {w.version && <span className="note">version {w.version}</span>}
                </button>
              ))}
            </div>
            <button style={{ marginTop: "1rem" }} onClick={() => setChoices(null)}>Cancel</button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

/** Seconds since epoch, ticking. Every countdown on every route reads the same clock. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
