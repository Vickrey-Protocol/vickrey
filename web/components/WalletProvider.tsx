"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
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
  /** Opens the picker. Never connects to a wallet the user did not name. */
  connect: () => Promise<void>;
  disconnect: () => void;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
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
  const connect = useCallback(async () => {
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
