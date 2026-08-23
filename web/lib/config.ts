import { AuctionKind, type AuctionTerms } from "@vickrey/client";

/**
 * Network configuration.
 *
 * There is deliberately **no Sepolia default for the deployed addresses**. STRK20
 * launched on mainnet, and privacy-wallet support for Sepolia is unconfirmed, so the
 * code must not quietly behave as though a testnet rehearsal is guaranteed. The
 * target network is stated explicitly, and an unset address surfaces as a banner
 * rather than a silent fallback.
 */
export type NetworkName = "mainnet" | "sepolia";

interface NetworkDefaults {
  rpcUrl: string;
  explorer: string;
  /** The STRK20 privacy pool. Verified on chain; see docs/deployments.md. */
  pool: string;
  strk: string;
  label: string;
}

export const NETWORKS: Record<NetworkName, NetworkDefaults> = {
  mainnet: {
    rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
    explorer: "https://starkscan.co",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    strk: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    label: "Starknet mainnet",
  },
  sepolia: {
    rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
    explorer: "https://sepolia.starkscan.co",
    pool: "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    strk: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    label: "Sepolia (rehearsal)",
  },
};

const rawNetwork = (process.env.NEXT_PUBLIC_NETWORK ?? "mainnet").toLowerCase();
export const network: NetworkName = rawNetwork === "sepolia" ? "sepolia" : "mainnet";
const defaults = NETWORKS[network];

export const config = {
  network,
  label: defaults.label,
  isMainnet: network === "mainnet",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? defaults.rpcUrl,
  explorer: process.env.NEXT_PUBLIC_EXPLORER ?? defaults.explorer,
  poolAddress: process.env.NEXT_PUBLIC_POOL_ADDRESS ?? defaults.pool,
  strkAddress: defaults.strk,
  auctionAddress: process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? "",
  anonymizerAddress: process.env.NEXT_PUBLIC_ANONYMIZER_ADDRESS ?? "",
};

export const isDeployed = () => config.auctionAddress.length > 0;
export const hasAnonymizer = () => config.anonymizerAddress.length > 0;

export const explorerTx = (hash: string) => `${config.explorer}/tx/${hash}`;
export const explorerContract = (addr: string) => `${config.explorer}/contract/${addr}`;

export const kindLabel = (k: AuctionKind) =>
  k === AuctionKind.Vickrey ? "Vickrey · second price" : "First price";

export function formatUnits(raw: bigint, decimals = 18, maxFrac = 4): string {
  const base = 10n ** BigInt(decimals);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const priceAt = (terms: AuctionTerms, level: number) =>
  terms.reservePrice + terms.tick * BigInt(level);

/** `h m s` remaining, or null once elapsed. */
export function countdown(deadline: number, now: number): string | null {
  const left = deadline - now;
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export const shortAddr = (a: string) =>
  a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
