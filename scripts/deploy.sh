#!/usr/bin/env bash
#
# Declares and deploys both contracts, verifies them by reading back from chain,
# and writes the addresses where the web app and strk20.json pick them up.
#
#   scripts/deploy.sh sepolia <sncast-account>
#   scripts/deploy.sh mainnet <sncast-account>
#
# The pool address is not a parameter. It is pinned per network below, verified
# against chain, because passing the wrong one silently produces an anonymizer that
# nothing can drive.
#
# Needs an sncast account profile. Never put a key in a tracked file:
#   sncast account create --name vickrey --url <rpc>
#   sncast account deploy --name vickrey --url <rpc>     # after funding it
#
set -euo pipefail

NETWORK="${1:?network required (sepolia | mainnet)}"
ACCOUNT="${2:?sncast account name required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── network facts, each verified by fetching it ───────────────────────────────
# Only one mainnet RPC answered every method the deploy needs (chainId,
# blockNumber, getClassHashAt, getClassAt, call). Blast is retired, publicnode
# and drpc fail on the class methods. If this one is down, find another that
# answers all five before deploying — a partial endpoint fails mid-declare.
case "$NETWORK" in
  mainnet)
    RPC="https://api.cartridge.gg/x/starknet/mainnet"
    POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
    POOL_CLASS="0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d"
    EXPLORER="https://starkscan.co"          # verified: /contract and /tx both live
    CHAIN_ID="0x534e5f4d41494e"
    ;;
  sepolia)
    RPC="https://api.cartridge.gg/x/starknet/sepolia"
    POOL="0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91"
    POOL_CLASS="0x56ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2"
    EXPLORER="https://sepolia.voyager.online" # sepolia.starkscan.co does not resolve
    CHAIN_ID="0x534e5f5345504f4c4941"
    ;;
  *) echo "unknown network: $NETWORK" >&2; exit 1 ;;
esac

OUT="deployments.${NETWORK}.json"

# The address is not in snfoundry.toml; ask sncast for it rather than asking the
# operator to retype it, because a mistyped address makes the balance check pass
# against somebody else's wallet.
ACCOUNT_ADDR="$(sncast account list 2>/dev/null \
  | awk -v want="- ${ACCOUNT}:" '$0==want {f=1; next} f && $1=="address:" {print $2; exit}')"
[ -n "$ACCOUNT_ADDR" ] || { echo "no sncast account named '$ACCOUNT' (see: sncast account list)" >&2; exit 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# sncast rejects --network when snfoundry.toml defines a url for the active
# profile, so every call passes --url explicitly and nothing relies on the file.
cast() { sncast --account "$ACCOUNT" "$@" --url "$RPC"; }
# sncast prints "Class Hash: 0x…" and "Contract Address: 0x…". Match the whole label
# and pull the hex out of it. A field split on whitespace silently returns the second
# *word* — "Address:" — which reads as an empty result and loses a paid-for declare.
field() { sed -n "s/^$1: *\(0x[0-9a-fA-F]*\).*/\1/p" | head -1; }

# ── preflight: never spend on a chain we have not confirmed ───────────────────
say "Building"
scarb build

# The money check needs to know which declares are still outstanding, and that is a
# question about the built artifacts — so the build comes first. It is free.
SKIP=""
for pair in \
  "declare SealedBidAuction|target/dev/auction_SealedBidAuction.contract_class.json" \
  "declare AuctionAnonymizer|target/dev/anonymizer_AuctionAnonymizer.contract_class.json"
do
  step="${pair%%|*}"; art="${pair##*|}"
  if [ "$(node scripts/lib/class-status.mjs "$RPC" "$art" | cut -d' ' -f1)" = declared ]; then
    SKIP="${SKIP:+$SKIP,}$step"
  fi
done

say "Preflight against $NETWORK"
echo "  account      $ACCOUNT_ADDR"
node scripts/lib/preflight.mjs "$RPC" "$POOL" "$POOL_CLASS" "$CHAIN_ID" "$ACCOUNT_ADDR" deploy "$SKIP"

say "Running the full suite before touching a live network"
snforge test

# A re-run after a partial failure must not pay for a declare twice. The class hash
# is computed from the artifact and looked up on chain, so this skips only when the
# exact build we are shipping is already there.
DECLARED=""
declare_class() {                        # sets DECLARED
  local label="$1" artifact="$2" name="$3" pkg="$4" status got
  say "Declaring $label"
  status="$(node scripts/lib/class-status.mjs "$RPC" "$artifact")"
  DECLARED="${status#* }"
  if [ "${status%% *}" = "declared" ]; then
    echo "  already on chain, skipping the declare"
    echo "  class_hash = $DECLARED"
    return
  fi
  got="$(cast declare --contract-name "$name" --package "$pkg" | field 'Class Hash')"
  [ -n "$got" ] || { echo "declare produced no class hash" >&2; exit 1; }
  echo "  class_hash = $got"
  DECLARED="$got"
}

declare_class SealedBidAuction \
  target/dev/auction_SealedBidAuction.contract_class.json SealedBidAuction auction
AUCTION_CLASS="$DECLARED"

declare_class AuctionAnonymizer \
  target/dev/anonymizer_AuctionAnonymizer.contract_class.json AuctionAnonymizer anonymizer
ANON_CLASS="$DECLARED"

say "Deploying SealedBidAuction"
AUCTION_ADDR="$(cast deploy --class-hash "$AUCTION_CLASS" | field 'Contract Address')"
[ -n "$AUCTION_ADDR" ] || { echo "deploy produced no address" >&2; exit 1; }
echo "  address = $AUCTION_ADDR"

say "Deploying AuctionAnonymizer (pool=$POOL)"
ANON_ADDR="$(cast deploy --class-hash "$ANON_CLASS" \
  --constructor-calldata "$POOL" "$AUCTION_ADDR" | field 'Contract Address')"
[ -n "$ANON_ADDR" ] || { echo "deploy produced no address" >&2; exit 1; }
echo "  address = $ANON_ADDR"

# ── read back, because a deploy that reports success can still be wired wrong ──
say "Verifying on chain"
node - "$RPC" "$AUCTION_ADDR" "$ANON_ADDR" "$POOL" <<'NODE'
const [, , rpc, auction, anon, pool] = process.argv;
const norm = (x) => BigInt(x).toString(16);
const call = async (contract_address, selectorName) => {
  const { hash } = await import("starknet");
  const r = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_call", params: {
      request: { contract_address, entry_point_selector: hash.getSelectorFromName(selectorName), calldata: [] },
      block_id: "latest" } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${selectorName}: ${JSON.stringify(j.error)}`);
  return j.result;
};
// Retry: a fresh deploy is PRE_CONFIRMED for a few seconds before it is callable.
const withRetry = async (fn) => {
  for (let i = 0; i < 20; i++) {
    try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw new Error("contract never became callable");
};
const count = await withRetry(() => call(auction, "auction_count"));
console.log(`  auction.auction_count        ${BigInt(count[0])}`);
const wired = await withRetry(() => call(anon, "privacy_contract"));
if (norm(wired[0]) !== norm(pool)) throw new Error(`anonymizer points at ${wired[0]}, not the pool`);
console.log(`  anonymizer.privacy_contract  matches the pool`);
const back = await withRetry(() => call(anon, "auction_contract"));
if (norm(back[0]) !== norm(auction)) throw new Error(`anonymizer points at ${back[0]}, not the auction`);
console.log(`  anonymizer.auction_contract  matches the auction`);
NODE

cat > "$OUT" <<JSON
{
  "network": "$NETWORK",
  "rpc": "$RPC",
  "explorer": "$EXPLORER",
  "pool": "$POOL",
  "SealedBidAuction": { "class_hash": "$AUCTION_CLASS", "address": "$AUCTION_ADDR" },
  "AuctionAnonymizer": { "class_hash": "$ANON_CLASS", "address": "$ANON_ADDR" }
}
JSON

say "Wrote $OUT"
cat "$OUT"

cat <<NOTE

Next:
  1. Point the site at it:
       vercel env add NEXT_PUBLIC_NETWORK $NETWORK
       vercel env add NEXT_PUBLIC_AUCTION_ADDRESS $AUCTION_ADDR
       vercel env add NEXT_PUBLIC_ANONYMIZER_ADDRESS $ANON_ADDR
       vercel --prod
  2. Put the addresses in strk20.json under "contracts".
  3. Run an auction:  AUCTION=$AUCTION_ADDR NETWORK=$NETWORK node scripts/live-auction.mjs
  4. Paste the resulting hashes into strk20.json under "transactions".
  5. Update the README status table. Nothing in it should claim more than is true.
NOTE
