"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortString, walletV6 } from "starknet";
import { readWalletError } from "@vickrey/client";
import { config } from "@/lib/config";
import { WAIT, withTimeout } from "@/lib/waiting";
import {
  availableWallets, connect as connectWallet, forgetWallet, injectedWalletHints, reconnect,
  rememberWallet, waitForAnyWallet, waitForWallet,
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
/** Friendly names for the chains we know, so one side of a sentence is not "SN_MAIN"
 *  while the other reads "Sepolia (rehearsal)". Anything unknown falls back to the
 *  decoded short string, which is still better than a felt. */
const FRIENDLY: Record<string, string> = {
  "0x534e5f4d41494e": "Starknet mainnet",
  "0x534e5f5345504f4c4941": "Sepolia",
};

export const chainName = (id: string | null) => {
  if (id && FRIENDLY[id]) return FRIENDLY[id]!;
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
  /** Feed a real STRK20 call's error in, so the rail can stop offering what cannot work. */
  noteStrk20Error: (e: unknown) => void;
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
  /** What to say when the ask did not end with the wallet on the right chain. */
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<string | null>(null);
  /** Set when a connect attempt found nothing to connect to. `hints` names any extension
   *  that put something on `window` without announcing itself. */
  const [noWallet, setNoWallet] = useState<{ hints: string[] } | null>(null);
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
            const got = await withTimeout(walletV6.requestChainId(w as never), WAIT.read);
            const id = got.outcome === "answered" ? got.value : null;
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
      if (!w) { setWalletChain(null); return null; }
      const got = await withTimeout(walletV6.requestChainId(w as never), WAIT.read);
      /* Rule 11 again: no answer is not "on the wrong chain", and it is not "on the right
         one" either. Null means unknown, and `ensureChain` already lets unknown through
         rather than blocking a wallet that simply does not report. */
      const id = got.outcome === "answered" ? got.value : null;
      setWalletChain(id);
      return id;
    } catch { setWalletChain(null); return null; }
  }, [connection?.walletName]);

  /* Read once on connect and after a switch. The wrong-chain banner is dismissible, so
     it cannot double as "which network is the wallet on" for the wallet menu. */
  useEffect(() => { if (connection) void readChain(); }, [connection, readChain]);

  /**
   * The wallet telling us it moved, which is the answer that does not depend on our
   * request being replied to.
   *
   * `subscribeWalletEvent` maps the legacy `networkChanged` / `accountsChanged` events
   * onto the standard "change" event. It covers the case our own promise cannot: the user
   * switching network in the extension directly, with no request of ours outstanding.
   */
  useEffect(() => {
    if (!connection) return;
    let live = true;
    let stop: (() => void) | undefined;
    void (async () => {
      const w = await waitForWallet(connection.walletName).catch(() => null);
      if (!w || !live) return;
      try {
        stop = walletV6.subscribeWalletEvent(w as never, () => { void readChain(); });
      } catch { /* a wallet without the events feature; the re-check below covers it */ }
    })();
    return () => { live = false; stop?.(); };
  }, [connection, readChain]);

  /**
   * A bounded re-check, and only while the mismatch modal is actually on screen.
   *
   * Not blind polling: it runs when a modal is telling the user to go and change
   * something, which is exactly the window in which they will, and it stops the moment
   * the chain is right. A wallet that neither replies to the request nor emits an event
   * would otherwise leave the modal up over a wallet that had already moved.
   */
  useEffect(() => {
    if (!wrongChain || !connection) return;
    const t = setInterval(() => { void readChain(); }, 2_500);
    return () => clearInterval(t);
  }, [wrongChain, connection, readChain]);

  /* One place decides the modal is done, so every route to the right chain closes it —
     our button, the wallet's event, the re-check, or a reconnect. */
  useEffect(() => {
    if (walletChain && walletChain === CHAIN_ID[config.network]) {
      setWrongChain(null);
      setSwitchNote(null);
    }
  }, [walletChain]);

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
  /**
   * Records what a real STRK20 call proved, from anywhere that makes one.
   *
   * The private rail's own calls are the other real evidence we get, and far more people
   * hit those than press the balance button. A rail that has already failed for a reason
   * that is not going to change should stop being offered — letting someone retry into
   * the same wallet error is the "let the bid fail" outcome.
   */
  const noteStrk20Error = useCallback((e: unknown) => {
    const err = readWalletError(e);
    /* Routed, not failed: the pool or the user answered. Also leave it untouched on an
       error carrying no code at all — that is an absence, not a negative answer. */
    if (err.code === null) return;
    setStrk20Proof(err.code === 118 || err.code === 113 ? "working" : "failed");
  }, []);

  const requestShielded = useCallback(async () => {
    if (!connection) return;
    setShieldedErr(null);
    setShieldedPending(true);
    try {
      const got = await withTimeout(
        connection.account.strk20Balances([config.strkAddress]), WAIT.balance);
      if (got.outcome === "no-answer") {
        /* Not a failure and not a refusal — see lib/waiting.ts. `strk20Proof` stays
           untouched, because silence proves nothing about the capability either way. */
        setShieldedErr("Your wallet has not answered. If a prompt is waiting in the "
          + "extension, approve it and try again.");
        return;
      }
      if (got.outcome === "failed") throw got.error;
      const entries = got.value;
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

  /**
   * Asks the wallet to move, and never waits forever for an answer.
   *
   * Ready X approved the switch and did not resolve `wallet_switchStarknetChain`. The
   * `await` never returned, so the `finally` that clears `switching` never ran and the
   * modal stayed on "Asking the wallet…" — while the wallet was already on the right
   * chain. The switch is bounded now, and silence is reported as silence rather than as
   * a refusal.
   *
   * Whether it resolved or not, the chain gets re-read: a wallet that answers late is
   * indistinguishable from one that never answers, and both end with the same question.
   */
  const switchChain = useCallback(async () => {
    setSwitching(true);
    setSwitchNote(null);
    try {
      const w = connection?.walletName ? await waitForWallet(connection.walletName) : null;
      if (!w) { setSwitchNote("Could not reach the wallet to ask."); return; }

      const asked = await withTimeout(
        walletV6.switchStarknetChain(w as never, CHAIN_ID[config.network]),
        WAIT.switch,
      );

      const id = await readChain();
      if (!id || id === CHAIN_ID[config.network]) { setWrongChain(null); return; }

      if (asked.outcome === "no-answer") {
        setSwitchNote(
          "We asked, and your wallet has not confirmed. Check for a pending prompt in the "
          + "extension — some wallets switch without replying to the request, in which "
          + "case this closes on its own once they report the new network.",
        );
      } else if (asked.outcome === "failed") {
        setSwitchNote("Your wallet declined the switch. You can change network in the "
          + "extension instead.");
      } else {
        setSwitchNote("Your wallet reported the switch, but still says it is on "
          + `${chainName(id)}. Changing network in the extension usually settles it.`);
      }
    } finally {
      setSwitching(false);
    }
  }, [connection?.walletName, readChain]);

  /**
   * Opens the picker, or explains why there is nothing to pick.
   *
   * With no extension installed this used to set an `error` string that the public
   * masthead never rendered — so the button did nothing at all, in silence. A judge
   * without a Starknet wallet clicks Connect, sees no response, and concludes the site is
   * broken. The explanation is a panel rendered by this provider rather than a message
   * each caller has to remember to display, which is what let one caller forget.
   *
   * It also waits. Discovery is an announcement protocol, so an empty list on a cold
   * click is "nobody has replied yet", and flashing "no wallet found" at someone who has
   * one is the same defect as the reconnect that forgot a locked wallet — Rule 11.
   */
  const connect = useCallback(async (goTo?: string) => {
    goToRef.current = goTo ?? null;
    setError(null);
    setNoWallet(null);
    setConnecting(true);
    try {
      const found = await waitForAnyWallet();
      if (found.length === 0) {
        /* Something on `window` but nothing announced is a different problem with a
           different fix, so the two are not collapsed into one message. */
        setNoWallet({ hints: injectedWalletHints() });
        return;
      }
      setChoices(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const choose = useCallback(async (w: WalletWithStarknetFeatures) => {
    setChoices(null);
    setConnecting(true);
    setError(null);
    try {
      const got = await withTimeout(connectWallet(w), WAIT.connect);
      if (got.outcome === "no-answer") {
        setError("Your wallet has not answered the connection request. Check for a "
          + "pending prompt in the extension, then try again.");
        return;
      }
      if (got.outcome === "failed") throw got.error;
      const c = got.value;
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
      shielded, shieldedPending, shieldedErr, requestShielded, strk20Proof, noteStrk20Error,
    }),
    [connection, error, connecting, reconnecting, connect, disconnect, ensureChain,
     walletChain, switchChain, switching,
     shielded, shieldedPending, shieldedErr, requestShielded, strk20Proof, noteStrk20Error],
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
              {/* Both halves friendly. One side read "Sepolia (rehearsal)" and the other
                  "SN_MAIN" in the same sentence, which made them look like different
                  kinds of thing. */}
              This app is reading <b>{FRIENDLY[CHAIN_ID[config.network]] ?? config.label}</b>.
              Your wallet is on <b>{chainName(wrongChain)}</b>.
            </p>
            <p className="note" style={{ marginTop: ".5rem" }}>
              Nothing has been signed. Signing from the wrong network fails inside the
              wallet after you have approved it, which is a worse place to find out.
            </p>
            {switchNote && (
              /* Shown when the ask did not end with the wallet on the right chain. It
                 never claims a refusal it cannot see — silence is reported as silence. */
              <p className="note" style={{ marginTop: ".6rem" }}>{switchNote}</p>
            )}
            <div className="row" style={{ gap: ".6rem", marginTop: "1.1rem" }}>
              <button className="primary" onClick={() => void switchChain()} disabled={switching}>
                {switching
                  ? "Asking the wallet…"
                  : `Switch to ${FRIENDLY[CHAIN_ID[config.network]] ?? config.label}`}
              </button>
              <button onClick={() => setWrongChain(null)}>Dismiss</button>
            </div>
            <p className="note" style={{ marginTop: ".7rem" }}>
              You can also change network in the extension — this closes itself either
              way, as soon as your wallet reports the new one.
            </p>
          </div>
        </div>
      )}
      {noWallet && (
        /* Rendered here rather than by each caller. The masthead's Connect button set an
           error string that only the dashboard gate knew how to display, so on the public
           site the click produced nothing at all. */
        <div className="picker-veil" role="dialog" aria-modal="true"
             aria-label="No Starknet wallet found" onClick={() => setNoWallet(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">
              {noWallet.hints.length ? "A wallet is installed but did not answer" : "No Starknet wallet found"}
            </p>

            {noWallet.hints.length ? (
              <>
                <p style={{ margin: ".5rem 0 0" }}>
                  Something Starknet-shaped is in this browser
                  {noWallet.hints.length <= 3 ? ` (${noWallet.hints.join(", ")})` : ""}, but it
                  did not respond to the discovery request.
                </p>
                <p className="note" style={{ marginTop: ".5rem" }}>
                  Usually that means it is <b>locked</b>, or disabled for this site, or too
                  old for the wallet standard this app uses. Unlock it and try again — this
                  needs Wallet API 0.10.3 or later for the private rail.
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: ".5rem 0 0" }}>
                  Bidding needs a Starknet wallet extension. Two support the STRK20 privacy
                  pool this app uses:
                </p>
                <div className="stack" style={{ gap: ".5rem", marginTop: ".9rem" }}>
                  <a className="rail" href="https://www.xverse.app/download" target="_blank"
                     rel="noreferrer">
                    <span className="rail-name">Xverse <span className="rail-tag">recommended</span></span>
                    <span className="note">
                      The only wallet we have measured working on both Sepolia and mainnet.
                    </span>
                  </a>
                  <a className="rail" href="https://www.ready.co" target="_blank"
                     rel="noreferrer">
                    <span className="rail-name">Ready</span>
                    <span className="note">
                      Works on mainnet. Its Sepolia pool reads fail, so the private rail is
                      unavailable on testnet.
                    </span>
                  </a>
                </div>
              </>
            )}

            {/* The important half: nothing about reading this site needs a wallet, and a
                visitor who came to check a claim can check all of it. */}
            <p className="note" style={{ marginTop: "1rem" }}>
              <b>You do not need one to look.</b> Every auction, every proof and every
              clearing price is public and readable without connecting anything.
            </p>
            <div className="row" style={{ gap: ".6rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <Link className="primary" href="/auctions" onClick={() => setNoWallet(null)}
                    style={{ textDecoration: "none" }}>
                Browse auctions
              </Link>
              <button onClick={() => setNoWallet(null)}>Close</button>
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
