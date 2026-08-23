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
