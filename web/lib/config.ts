import { AuctionKind, type AuctionTerms } from "@vickrey/client";

/**
 * Addresses come from the environment so the same build can point at Sepolia or
 * mainnet. Nothing is baked in: while these are empty the app says so rather than
 * pretending to be live.
 */
export const config = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia",
  network: process.env.NEXT_PUBLIC_NETWORK ?? "sepolia",
  auctionAddress: process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? "",
  anonymizerAddress: process.env.NEXT_PUBLIC_ANONYMIZER_ADDRESS ?? "",
  /** Live STRK20 pool on Sepolia; verified deployed and answering get_fee_amount. */
  poolAddress:
    process.env.NEXT_PUBLIC_POOL_ADDRESS ??
    "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  explorer: process.env.NEXT_PUBLIC_EXPLORER ?? "https://sepolia.voyager.online",
};

export const isDeployed = () => config.auctionAddress.length > 0;

export const explorerTx = (hash: string) => `${config.explorer}/tx/${hash}`;
export const explorerContract = (addr: string) => `${config.explorer}/contract/${addr}`;

export const kindLabel = (k: AuctionKind) =>
  k === AuctionKind.Vickrey ? "Vickrey (second-price)" : "First-price";

/** Formats a ladder level as a human price. */
export function formatPrice(terms: AuctionTerms, level: number, decimals = 18): string {
  const raw = terms.reservePrice + terms.tick * BigInt(level);
  return formatUnits(raw, decimals);
}

export function formatUnits(raw: bigint, decimals = 18): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}
