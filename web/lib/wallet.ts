"use client";

/**
 * Wallet connection, against the exact stack the STRK20 integration guide tested:
 * `starknet@10.4.0`, get-starknet 6.0.3, types-js 0.10.3. The npm `next` tags have
 * moved on (10.7.x / 6.0.4) but that combination is untested for STRK20, so it is
 * pinned rather than floated.
 *
 * STRK20 capability is detected with a **version query**, never by probing
 * `strk20Balances` — that is a balance read, so wallets gate it behind a consent
 * prompt for data this app has no business seeing. This app never asks for a viewing
 * key, and never sees private state.
 */
import { compareVersions, WalletAccountV6, walletV6 } from "starknet";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { provider } from "./chain";
import { config } from "./config";

export interface Connection {
  account: WalletAccountV6;
  address: string;
  /** Whether the wallet speaks Wallet API >= 0.10.3, which is what STRK20 needs. */
  strk20: boolean;
  walletName: string;
}

export async function availableWallets(): Promise<WalletWithStarknetFeatures[]> {
  const { createStore } = await import("@starknet-io/get-starknet-discovery");
  const store = createStore();
  store._refreshInjectedWallets();
  return store.getWallets();
}

/**
 * starknet.js 10.4.0 vendors its Wallet API types under its own package name
 * (`@starknet-io/starknet-types-0103`), while `get-starknet-wallet-standard@6.0.3`
 * resolves its own copy of `@starknet-io/types-js`. The two are structurally the same
 * — same Wallet API 0.10.3 shapes — but nominally distinct, so TypeScript refuses the
 * handoff. An `overrides` pin cannot merge them because the package *names* differ.
 *
 * This cast is that mismatch and nothing else. It is confined to the boundary, and it
 * is the reason the versions in package.json are pinned exactly rather than floated:
 * re-verify this when any of them moves.
 */
const asV6Wallet = (w: WalletWithStarknetFeatures) =>
  w as unknown as Parameters<typeof walletV6.supportedWalletApi>[0];

/**
 * Remembers which wallet was authorised, so a reload can re-attach to it silently.
 *
 * The wallet's *name* only — never a key, never an address. It is the minimum needed to
 * find the same injected wallet again, and it is worthless to anyone who reads it.
 *
 * An explicit disconnect clears it, and that has to persist: a user who disconnected and
 * reloaded should stay disconnected, not be quietly signed back in.
 */
const REMEMBERED = "vickrey.wallet";

export const rememberWallet = (name: string) => {
  try { window.localStorage.setItem(REMEMBERED, name); } catch { /* private mode */ }
};
export const forgetWallet = () => {
  try { window.localStorage.removeItem(REMEMBERED); } catch { /* private mode */ }
};
export const rememberedWallet = (): string | null => {
  try { return window.localStorage.getItem(REMEMBERED); } catch { return null; }
};

/**
 * Re-attaches to an already-authorised wallet without any prompt.
 *
 * `silent_mode` tells the wallet not to show its unlock UI for a locked wallet, nor its
 * approve UI for a dapp it has not been granted. So this either succeeds because the
 * user already said yes, or it fails and we show the connect button as though nothing
 * happened. A reload that pops a wallet prompt reads as broken, which is the whole
 * reason this exists.
 */
export async function reconnect(): Promise<Connection | null> {
  const name = rememberedWallet();
  if (!name) return null;
  const found = await availableWallets().catch(() => []);
  const chosen = found.find((w) => w.name === name);
  if (!chosen) return null;

  try {
    const accounts = await walletV6.requestAccounts(asV6Wallet(chosen), true);
    if (!accounts?.length) return null;
  } catch {
    return null;   // locked, revoked, or the wallet does not implement silent mode
  }
  return connect(chosen);
}

export async function connect(wallet?: WalletWithStarknetFeatures): Promise<Connection> {
  const chosen = wallet ?? (await availableWallets())[0];
  if (!chosen) {
    throw new Error(
      "No Starknet wallet detected. STRK20 needs one supporting Wallet API 0.10.3 or later.",
    );
  }

  const account = await WalletAccountV6.connect(provider(), asV6Wallet(chosen));

  let strk20 = false;
  try {
    const versions = await walletV6.supportedWalletApi(asV6Wallet(chosen));
    strk20 = versions.some((v) => compareVersions(v, "0.10.3") >= 0);
  } catch {
    strk20 = false;
  }

  return { account, address: account.address, strk20, walletName: chosen.name };
}

export const poolConfigured = () => config.poolAddress.length > 0;

/** Padded and unpadded hex can name the same address. Compare as numbers. */
export const sameAddress = (a: string, b: string) => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};
