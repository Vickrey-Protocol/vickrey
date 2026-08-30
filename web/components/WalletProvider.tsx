"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import { shortString, walletV6 } from "starknet";
import { readWalletError } from "@vickrey/client";
import { config } from "@/lib/config";
import {
  availableWallets, connect as connectWallet, forgetWallet, reconnect, rememberWallet,
  waitForWallet,
  rememberedWallet, type Connection,
} from "@/lib/wallet";
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
export const CHAIN_ID = {
  mainnet: "0x534e5f4d41494e",
  sepolia: "0x534e5f5345504f4c4941",
} as const;
export const chainName = (id: string | null) => {
  if (!id) return "unknown";
  try { return shortString.decodeShortString(id); } catch { return id; }
};

interface WalletState {
  connection: Connection | null;
  error: string | null;
  connecting: boolean;
  /** True only while a silent reconnect is in flight, so the UI can wait rather than
   *  flash "Connect wallet" and swap to an address a moment later. */
  reconnecting: boolean;
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
  /** The chain id the wallet reports, or null if it will not say. */
  walletChain: string | null;
  /** Asks the wallet to move to the network this build reads. */
  switchChain: () => Promise<void>;
  switching: boolean;
  /** Shielded STRK, once the user has asked for it. Null until then, and after reload. */
  shielded: bigint | null;
  shieldedPending: boolean;
  shieldedErr: string | null;
  requestShielded: () => Promise<void>;
  /** What a real STRK20 call established. Never inferred from the version string. */
  strk20Proof: "untested" | "working" | "failed";
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(() => {
    /* Seeded synchronously so the very first paint already knows a reconnect is coming.
       Starting at false and flipping in an effect is what produces the flash. */
    if (typeof window === "undefined") return false;
    try { return !!window.localStorage.getItem("vickrey.wallet"); } catch { return false; }
  });
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
  const [walletChain, setWalletChain] = useState<string | null>(null);
  /* Session-only, deliberately: see `requestShielded`. */
  const [shielded, setShielded] = useState<bigint | null>(null);
  const [shieldedPending, setShieldedPending] = useState(false);
  const [shieldedErr, setShieldedErr] = useState<string | null>(null);
  /**
   * What a *real* STRK20 call established, as opposed to what the wallet advertises.
   *
   *   untested — nobody has asked yet. Not a claim in either direction.
   *   working  — a pool read completed, or the pool answered NOT_REGISTERED, which
   *              proves the wallet routed it.
   *   failed   — a real call came back with an error that is not about our request.
   */
  const [strk20Proof, setStrk20Proof] =
    useState<"untested" | "working" | "failed">("untested");
  const goToRef = useRef<string | null>(null);

  /**
   * One silent attempt on mount. Failure is not an error state — the connect button is
   * the fallback and the user is told nothing, because nothing went wrong from their
   * side.
   *
   * It used to call `forgetWallet()` when the attempt came back empty, and that turned
   * every transient failure into a permanent one. A wallet that is merely **locked**, or
   * that has not finished announcing itself, or that does not implement `silent_mode`,
   * all return null here — and erasing the remembered name on any of them means the next
   * reload has nothing to reconnect to either, and the one after that. One locked reload
   * cost the user the session for good, which is exactly the "Connect to act" this was
   * built to prevent.
   *
   * Only an explicit disconnect forgets. Retrying silently on every load costs nothing:
   * silent mode cannot prompt, so a revoked grant just keeps failing quietly.
   */
  useEffect(() => {
    if (!rememberedWallet()) return;
    let live = true;
    (async () => {
      try {
        const c = await reconnect();
        if (!live) return;
        if (c) {
          setConnection(c);
          const w = await waitForWallet(c.walletName).catch(() => null);
          if (w) {
            const id = await walletV6.requestChainId(w as never).catch(() => null);
            if (id && id !== CHAIN_ID[config.network]) setWrongChain(id);
          }
        }
      } catch { /* stays remembered; the connect button is the fallback */ }
      finally { if (live) setReconnecting(false); }
    })();
    return () => { live = false; };
  }, []);

  const readChain = useCallback(async (): Promise<string | null> => {
    try {
      /* By name, and waiting for it — the same announcement race as the reconnect. A
         snapshot taken too early answers "no wallet", which here reads as "will not say
         which chain it is on" and silently skips the mismatch guard. */
      const w = connection?.walletName ? await waitForWallet(connection.walletName) : null;
      const id = w ? await walletV6.requestChainId(w as never) : null;
      setWalletChain(id);
      return id;
    } catch { setWalletChain(null); return null; }
  }, [connection?.walletName]);

  /* Read once on connect and after a switch. The wrong-chain banner is dismissible, so
     it cannot double as "which network is the wallet on" for the wallet menu. */
  useEffect(() => { if (connection) void readChain(); }, [connection, readChain]);

  /**
   * The account's shielded balance, and the one number this app asks the wallet for.
   *
   * `wallet_strk20Balances` is answered by the wallet using the viewing key it already
   * holds; the key itself never crosses the boundary, and the wallet gates the call
   * behind its own consent prompt (`USER_REFUSED_OP` is in the method's error set). So
   * this does not make the app a viewing-key holder. It does disclose one figure to this
   * page — whole-account, never scoped to an auction — which is why nothing here runs
   * unless the user presses the button.
   *
   * Session-only on purpose: it lives in React state and nowhere else, so a reload puts
   * the account back to undisclosed. Persisting the preference would quietly turn a
   * decision made once into a disclosure repeated on every visit.
   */
  const requestShielded = useCallback(async () => {
    if (!connection) return;
    setShieldedErr(null);
    setShieldedPending(true);
    try {
      const entries = await connection.account.strk20Balances([config.strkAddress]);
      const hit = entries.find((e) => BigInt(e.token) === BigInt(config.strkAddress))
        ?? entries[0];
      setShielded(hit ? BigInt(hit.balance) : 0n);
      setStrk20Proof("working");
    } catch (e) {
      /* `String(e)` here was destroying the evidence: a JSON-RPC error is a plain object,
         not an `Error`, so it stringified to "[object Object]" and the numeric code — the
         only field the spec fills with information — never reached the screen. And the
         spec's own message is "An error occurred (NAME)" for every error it defines, so
         passing that through shows the user nothing either way. */
      const err = readWalletError(e);
      setShieldedErr(err.recognised
        ? err.say
        // Rule 11: unrecognised is not a licence to name it. Say so, and show the raw.
        : `${err.say} Raw: ${err.raw}`);
      /* NOT_REGISTERED and a refusal both mean the wallet understood and routed the
         call — shape confirmed, state simply absent. Everything else is a failure of
         the read itself. */
      setStrk20Proof(err.code === 118 || err.code === 113 ? "working" : "failed");
    } finally {
      setShieldedPending(false);
    }
  }, [connection]);

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
      const w = connection?.walletName ? await waitForWallet(connection.walletName) : null;
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
      rememberWallet(c.walletName);
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
    setWrongChain(null);
    setWalletChain(null);
    // A balance disclosed by one account must not survive into the next.
    setShielded(null);
    setShieldedErr(null);
    setStrk20Proof("untested");
    // Persisted, so a reload does not sign them straight back in.
    forgetWallet();
  }, []);

  const value = useMemo(
    () => ({
      connection, error, connecting, reconnecting, connect, disconnect, ensureChain,
      walletChain, switchChain, switching,
      shielded, shieldedPending, shieldedErr, requestShielded, strk20Proof,
    }),
    [connection, error, connecting, reconnecting, connect, disconnect, ensureChain,
     walletChain, switchChain, switching,
     shielded, shieldedPending, shieldedErr, requestShielded, strk20Proof],
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
