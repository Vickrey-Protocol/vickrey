"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { compareVersions, RpcProvider, shortString, walletV6 } from "starknet";
import { probeMissing } from "@vickrey/client";
import {
  REAL_READ_LABEL, reachabilityAnswered, reachabilityRejected, realReadFailed, realReadPassed,
} from "@/lib/walletCheck";
import { availableWallets, injectedWalletHints, waitForAnyWallet } from "@/lib/wallet";
import { STRK_DECIMALS, config, formatUnits } from "@/lib/config";
import { PublicShell } from "@/components/PublicShell";
import { useWallet } from "@/components/WalletProvider";

/**
 * Does this wallet actually speak STRK20, on this network?
 *
 * It gates everything. The three mainnet transactions the sprint counts must each touch
 * the pool, and pool transactions are proved *inside the wallet* — `sncast` has no
 * prover, so no amount of scripting substitutes. If the wallet cannot do it, the entry
 * cannot satisfy the requirement, and that is worth knowing before spending anything on
 * a declare.
 *
 * Every check on this page is free. Nothing here signs a transaction or moves a token.
 */
type Check = { label: string; state: "pass" | "fail" | "warn" | "pending"; detail: string };

const STRK20_METHODS = ["strk20Balances", "strk20PrepareInvoke", "strk20InvokeTransaction"] as const;

const CHAIN_ID = {
  mainnet: "0x534e5f4d41494e",
  sepolia: "0x534e5f5345504f4c4941",
} as const;

/** Decodes SN_MAIN / SN_SEPOLIA from the felt a wallet returns. */
const chainName = (id: string | null) => {
  if (!id) return "unknown";
  if (id.startsWith("refused")) return id;
  try { return shortString.decodeShortString(id); } catch { return id; }
};

export default function Client() {
  const { connection, connect, connecting, reconnecting, error, disconnect } = useWallet();
  const [detected, setDetected] = useState<string[]>([]);
  const [versions, setVersions] = useState<string[] | null>(null);
  const [pool, setPool] = useState<Check[]>([]);
  const [balProbe, setBalProbe] = useState<Check | null>(null);
  const [reachProbe, setReachProbe] = useState<Check | null>(null);
  const [probing, setProbing] = useState(false);
  /** The chain the *wallet* is on, which is not necessarily the one the site reads. */
  const [walletChain, setWalletChain] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  /* Waited for, not snapshotted. Discovery is an announcement protocol, so reading the
     store on mount reports "none" for a browser that has a wallet which has not replied
     yet — and reporting that on the page whose entire job is telling you what you have
     is the worst place in the app to get it wrong. */
  const [detecting, setDetecting] = useState(true);
  useEffect(() => {
    void waitForAnyWallet().then((w) => {
      setDetected(w.map((x) => x.name));
      setDetecting(false);
    });
  }, []);

  useEffect(() => {
    (async () => {
      const p = new RpcProvider({ nodeUrl: config.rpcUrl });
      const read = async (fn: string) => {
        const r = await p.callContract({
          contractAddress: config.poolAddress, entrypoint: fn, calldata: [],
        });
        return BigInt(r[0]!);
      };
      const out: Check[] = [];
      try {
        const paused = await read("is_paused");
        out.push({ label: "Pool is accepting transactions", detail: paused ? "PAUSED" : "not paused",
          state: paused ? "fail" : "pass" });
      } catch (e) {
        out.push({ label: "Pool reachable", state: "fail",
          detail: e instanceof Error ? e.message : String(e) });
      }
      try {
        const fee = await read("get_fee_amount");
        out.push({ label: "Pool fee, read live", state: "pass",
          detail: `${formatUnits(fee, STRK_DECIMALS)} STRK per operation — charged on every pool action, the shield included` });
      } catch { /* reported by the reachability line above */ }
      try {
        const v = await read("get_version");
        out.push({ label: "Pool version", state: "pass", detail: v.toString() });
      } catch { /* as above */ }
      setPool(out);
    })();
  }, []);

  useEffect(() => {
    if (!connection) return;
    (async () => {
      try {
        const ws = await availableWallets();
        const w = ws.find((x) => x.name === connection.walletName) ?? ws[0];
        if (!w) return;
        setVersions(await walletV6.supportedWalletApi(w as never));
      } catch { setVersions([]); }
      try {
        const ws2 = await availableWallets();
        const w2 = ws2.find((x) => x.name === connection.walletName) ?? ws2[0];
        if (w2) setWalletChain(await walletV6.requestChainId(w2 as never));
      } catch { setWalletChain(null); }
    })();
  }, [connection]);

  /**
   * Two calls, deliberately, because the difference between them is the bug this page
   * shipped.
   *
   * The old probe invoked `strk20Balances` **with no arguments**. `tokens` is a required
   * parameter, so that put `params: {}` on the wire — not a balance read at all. Any
   * reply was recorded as "this wallet implements STRK20", and that is the claim the
   * funding decision rested on. It established that the *method exists*, which is a
   * different and much weaker fact.
   *
   * So the real read runs first and is the one that counts: a genuine token list, the
   * exact call the app makes. The argumentless one is kept beneath it, labelled as a
   * reachability check, because when the two disagree that disagreement is the finding —
   * a wallet that routes the method but cannot complete a read on this network.
   *
   * Both are free and neither signs anything.
   */
  const probeBalances = async () => {
    if (!connection) return;
    setProbing(true);
    setBalProbe(null);
    setReachProbe(null);
    /* `strk20Balances` never touches our RPC — the wallet answers it, for whatever
       network the *wallet* is on. Labelling the result with `config.label` would
       therefore be wrong the moment the two differ, and it is exactly when they differ
       that this page is being used. Read it fresh, at the moment of the call. */
    let onNet = chainName(walletChain);
    try {
      const found = await availableWallets();
      const w = found.find((x) => x.name === connection.walletName);
      if (w) {
        const id = await walletV6.requestChainId(w as never);
        setWalletChain(id);
        onNet = chainName(id);
      }
    } catch { /* keep whatever we last read; the label says "unknown" if we never did */ }

    try {
      const acct = connection.account as unknown as Record<string, unknown>;
      const fn = acct["strk20Balances"];
      if (typeof fn !== "function") {
        const v = probeMissing();
        setBalProbe({ label: REAL_READ_LABEL, state: "fail", detail: v.reason });
        return;
      }
      const call = fn as (tokens?: unknown) => Promise<unknown>;

      /* 1. The call the app actually makes. */
      try {
        const entries = await call.call(acct, [config.strkAddress]);
        setBalProbe(realReadPassed(Array.isArray(entries) ? entries.length : 0, onNet));
      } catch (e) {
        setBalProbe(realReadFailed(e, onNet));
      }

      /* 2. The old probe, kept so the discrepancy is visible rather than inferred. Its
            verdict is written separately on purpose — see lib/walletCheck.ts. */
      try {
        await call.call(acct);
        setReachProbe(reachabilityAnswered());
      } catch (e) {
        setReachProbe(reachabilityRejected(e));
      }
    } finally { setProbing(false); }
  };

  /**
   * Ask the wallet to move to the network the site is reading.
   *
   * Worth an explicit button because the alternative is a probe whose answer is about a
   * different chain than the one you are testing — which looks like a result and is not
   * one. A wallet that refuses the switch has told us something too: that network is
   * not available in it.
   */
  const switchChain = async () => {
    if (!connection) return;
    setSwitching(true);
    try {
      const ws = await availableWallets();
      const w = ws.find((x) => x.name === connection.walletName) ?? ws[0];
      if (!w) return;
      await walletV6.switchStarknetChain(w as never, CHAIN_ID[config.network]);
      setWalletChain(await walletV6.requestChainId(w as never));
    } catch (e) {
      setWalletChain(`refused: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSwitching(false); }
  };

  const capable = versions?.some((v) => compareVersions(v, "0.10.3") >= 0) ?? false;
  const row = (c: Check) => (
    <tr key={c.label}>
      <td><span className={`pill ${c.state === "pass" ? "resolved" : c.state === "fail" ? "cancelled" : "sealed"}`}>
        {c.state}</span></td>
      <td>{c.label}</td>
      <td className="note">{c.detail}</td>
    </tr>
  );

  return (
    <PublicShell>
      <h1 className="display" style={{ fontSize: "var(--step-3)" }}>Wallet check</h1>
      <p style={{ maxWidth: "62ch", marginTop: ".6rem" }}>
        Whether this wallet can drive the STRK20 pool on <b>{config.label}</b>. Every
        check here is free — nothing signs a transaction and nothing moves a token.
      </p>
      <p className="note" style={{ maxWidth: "62ch", marginTop: ".5rem" }}>
        The network matters as much as the wallet. A pool exists on both Sepolia and
        mainnet, but a wallet that offers STRK20 on one does not necessarily offer it on
        the other — wallet features ship per-network. This page checks the pair, not the
        wallet alone.
      </p>

      <h2 className="section">The pool</h2>
      <div className="panel scroller">
        <table><tbody>{pool.length ? pool.map(row) : (
          <tr><td className="note">Reading {config.label}…</td></tr>)}</tbody></table>
      </div>

      <h2 className="section">This wallet</h2>
      <div className="panel">
        {connection ? (
          <>
            {/* Three wallets were detected and one of them answered. Which one matters:
                it is the wallet that must hold the shielded balance and produce the
                three qualifying transactions. */}
            <p className="eyebrow">Answering</p>
            <p className="display" style={{ fontSize: "var(--step-1)", margin: ".2rem 0 .1rem" }}>
              {connection.walletName}
            </p>
            <p className="note mono" style={{ wordBreak: "break-all" }}>{connection.address}</p>
            <div className="row" style={{ gap: ".6rem", marginTop: ".8rem" }}>
              <button onClick={() => { setBalProbe(null); setWalletChain(null); disconnect(); }}>
                Test a different wallet
              </button>
            </div>
            <p className="note" style={{ marginTop: ".5rem" }}>
              Also detected but not connected:{" "}
              {detected.filter((d) => d !== connection.walletName).join(", ") || "none"}. Every
              check below describes <b>{connection.walletName}</b> only — fund this wallet, not
              another one.
            </p>
          </>
        ) : (
          <p className="note">
            Detected in this browser:{" "}
            {detecting ? "looking…"
              : detected.length ? <b>{detected.join(", ")}</b>
              /* Something on `window` that never announced is a different state with a
                 different fix — usually locked, or too old for wallet-standard
                 discovery — so it is not reported as "none". */
              : injectedWalletHints().length
                ? <b>none answered, though something is installed ({injectedWalletHints().join(", ")})</b>
                : "none"}
          </p>
        )}
        {!connection ? (
          <>
            <button className="primary" style={{ marginTop: ".9rem" }}
                    onClick={() => void connect()} disabled={connecting || reconnecting}>
              {reconnecting ? "Reconnecting…" : connecting ? "Connecting…" : "Connect wallet"}
            </button>
            {error && <p className="err" style={{ marginTop: ".6rem" }}>{error}</p>}
          </>
        ) : (
          <div className="scroller" style={{ marginTop: ".9rem" }}>
            <table><tbody>
              {row({ label: "Connected", state: "pass", detail: `${connection.walletName} · ${connection.address}` })}
              {row({
                label: "Wallet is on the same network as this page",
                state: walletChain === null ? "pending"
                  : walletChain === CHAIN_ID[config.network] ? "pass" : "fail",
                detail: walletChain === null ? "reading…"
                  : walletChain === CHAIN_ID[config.network]
                    ? `both on ${chainName(walletChain)}`
                    : `page reads ${config.label} (${chainName(CHAIN_ID[config.network])}), wallet is on ${chainName(walletChain)} — every check below would be about the wrong chain`,
              })}
              {row({ label: "Wallet API versions offered", state: versions ? "pass" : "pending",
                detail: versions?.length ? versions.join(", ") : "reading…" })}
              {row({ label: "Wallet API ≥ 0.10.3 (what STRK20 needs)", state: capable ? "pass" : "fail",
                detail: capable ? "yes" : "no — this wallet cannot do the pool leg" })}
              {STRK20_METHODS.map((m) => {
                const has = typeof (connection.account as unknown as Record<string, unknown>)[m] === "function";
                return row({ label: `account.${m}`, state: has ? "pass" : "fail",
                  detail: has ? "present" : "missing" });
              })}
              {balProbe && row(balProbe)}
              {reachProbe && row(reachProbe)}
            </tbody></table>
          </div>
        )}
      </div>

      {connection && walletChain !== null && walletChain !== CHAIN_ID[config.network] && (
        <div className="panel accent" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">Wrong network</p>
          <p style={{ marginTop: ".5rem" }}>
            This page reads <b>{config.label}</b>. Your wallet is on{" "}
            <b>{chainName(walletChain)}</b>. Probing now would answer a question about the
            other chain, which is worse than not answering — it looks like a result.
          </p>
          <button className="primary" style={{ marginTop: ".9rem" }}
                  onClick={() => void switchChain()} disabled={switching}>
            {switching ? "Asking the wallet…" : `Switch the wallet to ${config.label}`}
          </button>
          <p className="note" style={{ marginTop: ".6rem" }}>
            If the wallet refuses, that is itself the answer: it does not offer{" "}
            {config.label}, and this leg cannot be rehearsed there.
          </p>
        </div>
      )}

      {connection && (
        <div className="panel accent" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">The decisive test, and it is free</p>
          <p style={{ marginTop: ".5rem" }}>
            This runs <code>strk20Balances</code> <b>with a real token list</b> — the exact
            call the app makes when you ask for a shielded balance. A wallet that completes
            it can do pool reads here. One that answers <code>NOT_REGISTERED</code>, or that
            you decline, has still routed the call and passes: those are the pool and you
            replying, not the wallet failing.
          </p>
          <p className="note" style={{ marginTop: ".5rem" }}>
            An earlier version of this page called the method <b>with no arguments</b>,
            which is not a balance read — <code>tokens</code> is required, so it put an
            empty payload on the wire. It measured that the method was reachable and
            reported that as STRK20 working. Both calls run now, separately labelled,
            because a wallet can pass the second and fail the first.
          </p>
          <p className="note" style={{ marginTop: ".5rem" }}>
            The wallet answers for <b>whichever network it is on</b>, not the one this site
            reads — so the result below names the wallet&rsquo;s network. To fill in both
            rows, switch networks in your wallet and run it again. Nothing is displayed
            here, nothing is signed, and nothing leaves your browser.
          </p>
          <button className="primary" style={{ marginTop: ".9rem" }}
                  onClick={() => void probeBalances()} disabled={probing}>
            {probing ? "Waiting for the wallet…" : "Run the free STRK20 probe"}
          </button>
        </div>
      )}

      <h2 className="section">If it passes</h2>
      <div className="panel">
        <p>
          The next step is a real shield. The Wallet API has three STRK20 <i>methods</i> —{" "}
          <code>strk20Balances</code>, <code>strk20PrepareInvoke</code>,{" "}
          <code>strk20InvokeTransaction</code> — and none is <i>named</i> deposit, but{" "}
          <code>strk20InvokeTransaction</code> carries <i>actions</i> and the action union
          includes <code>STRK20_DEPOSIT_ACTION</code>. So a dapp can drive a deposit; the
          claim that only a wallet&rsquo;s own interface can shield was wrong.
          <b> This site still does not do it for you</b> — shielding your first note is a
          step we deliberately leave to the wallet, where you can see the amount.
        </p>
        <p className="note" style={{ marginTop: ".6rem" }}>
          Open your wallet, find its private or shielded balance section, and shield the
          smallest amount it will accept. Budget the pool fee above on top of it. Then
          come back and run the probe again — it should still answer, and your wallet
          should now show a shielded balance.
        </p>
        <p className="note" style={{ marginTop: ".6rem" }}>
          Full instructions: <Link href="/">the checklist in the repo</Link>, section 0.
        </p>
      </div>
    </PublicShell>
  );
}
