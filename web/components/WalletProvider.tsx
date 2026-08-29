"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
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
  const goToRef = useRef<string | null>(null);

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
      setConnection(await connectWallet(w));
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
    () => ({ connection, error, connecting, connect, disconnect }),
    [connection, error, connecting, connect, disconnect],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
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
