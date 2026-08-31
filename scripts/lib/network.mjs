/**
 * Which chain a script is talking to, and where that decision came from.
 *
 * `pool-status.mjs` defaulted to mainnet. Run against an address that had just shielded
 * on Sepolia it reported "not registered" — a confident negative about a question nobody
 * asked, from a script whose whole job is turning "did that work?" into a fact. Same
 * shape as the wallet-check bug that labelled a wallet's answer with the site's network
 * rather than the wallet's.
 *
 * Two rules follow, and both are enforced here rather than left to each script.
 *
 * **The resolution is explicit and its source is reported.** A default silently applied
 * is exactly how a wrong network goes unnoticed; a default *named* as a default invites
 * the reader to check it. `describe()` returns "sepolia (from --network)" or
 * "mainnet (default — nothing set)" so the answer can never be separated from its basis.
 *
 * **No script may print chain state without naming its chain.** A status line that does
 * not say which network it read is not a status, it is a rumour.
 */
import { readFileSync } from "node:fs";

export const NETWORKS = {
  mainnet: {
    rpc: "https://api.cartridge.gg/x/starknet/mainnet",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    explorer: "https://starkscan.co",
    keychain: "alpha-mainnet",
    chainId: "0x534e5f4d41494e",
  },
  sepolia: {
    rpc: "https://api.cartridge.gg/x/starknet/sepolia",
    pool: "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    explorer: "https://sepolia.voyager.online",
    keychain: "alpha-sepolia",
    chainId: "0x534e5f5345504f4c4941",
  },
};

/** The token is the same address on both, but read it from here rather than assuming. */
export const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const other = (net) => (net === "mainnet" ? "sepolia" : "mainnet");

/** What the working tree is currently pointed at, if it says. */
function fromEnvFile() {
  for (const f of ["web/.env.local", "web/.env"]) {
    try {
      const m = /^NEXT_PUBLIC_NETWORK\s*=\s*(\w+)/m.exec(readFileSync(f, "utf8"));
      if (m && NETWORKS[m[1]]) return [m[1], f];
    } catch { /* not present */ }
  }
  return null;
}

/**
 * Order: an explicit flag, then `NETWORK`, then whatever the repo is targeting, then a
 * default that says it is one.
 */
export function resolveNetwork(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--network");
  if (i !== -1 && argv[i + 1]) {
    const n = argv[i + 1];
    if (!NETWORKS[n]) fail(n);
    return { network: n, source: "--network", ...NETWORKS[n] };
  }
  if (process.env.NETWORK) {
    const n = process.env.NETWORK;
    if (!NETWORKS[n]) fail(n);
    return { network: n, source: "NETWORK env", ...NETWORKS[n] };
  }
  const env = fromEnvFile();
  if (env) return { network: env[0], source: env[1], ...NETWORKS[env[0]] };

  /* Sepolia, because rehearsing is the safe mistake: a script pointed at testnet by
     accident reports the wrong thing, and one pointed at mainnet by accident can spend. */
  return { network: "sepolia", source: "default — nothing set", ...NETWORKS.sepolia };
}

function fail(n) {
  console.error(`unknown network: ${n}. Expected mainnet or sepolia.`);
  process.exit(1);
}

/** Always printed. Never a bare network name without its provenance. */
export const describe = (r) => `${r.network} (${r.source})`;
