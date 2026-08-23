#!/usr/bin/env bash
#
# Declares and deploys both contracts, then writes the addresses where the web app
# and strk20.json can pick them up.
#
# Needs an sncast account profile. Create one first, and never put a key in a file
# this repo tracks:
#
#   sncast account create  --name vickrey --network sepolia
#   sncast account deploy  --name vickrey --network sepolia   # after funding it
#
# Usage:  scripts/deploy.sh <network> <account> <privacy_pool_address>
#   e.g.  scripts/deploy.sh sepolia vickrey 0x0
#
# The pool address is stored in the anonymizer's constructor and pins who may call
# privacy_invoke. Pass the real pool for the network you are deploying to; 0x0 leaves
# the helper callable by nobody, which is the safe default for a contracts-only deploy.

set -euo pipefail

NETWORK="${1:?network required (sepolia | mainnet)}"
ACCOUNT="${2:?sncast account name required}"
POOL="${3:?privacy pool address required (0x0 to leave unset)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="deployments.${NETWORK}.json"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Building"
scarb build

say "Running the full test suite before touching a live network"
snforge test

cast() { sncast --account "$ACCOUNT" "$@" --network "$NETWORK"; }

# sncast prints `field: value` lines; pull one out.
field() { awk -v k="$1:" '$1==k {print $2}'; }

say "Declaring SealedBidAuction"
AUCTION_CLASS="$(cast declare --contract-name SealedBidAuction | field class_hash)"
echo "class_hash = $AUCTION_CLASS"

say "Deploying SealedBidAuction"
AUCTION_ADDR="$(cast deploy --class-hash "$AUCTION_CLASS" | field contract_address)"
echo "address = $AUCTION_ADDR"

say "Declaring AuctionAnonymizer"
ANON_CLASS="$(cast declare --contract-name AuctionAnonymizer | field class_hash)"
echo "class_hash = $ANON_CLASS"

say "Deploying AuctionAnonymizer (pool=$POOL, auction=$AUCTION_ADDR)"
ANON_ADDR="$(cast deploy --class-hash "$ANON_CLASS" \
  --constructor-calldata "$POOL" "$AUCTION_ADDR" | field contract_address)"
echo "address = $ANON_ADDR"

cat > "$OUT" <<JSON
{
  "network": "$NETWORK",
  "pool": "$POOL",
  "SealedBidAuction": { "class_hash": "$AUCTION_CLASS", "address": "$AUCTION_ADDR" },
  "AuctionAnonymizer": { "class_hash": "$ANON_CLASS", "address": "$ANON_ADDR" }
}
JSON

say "Wrote $OUT"
cat "$OUT"

cat <<NOTE

Next:
  1. Put these in web/.env.local:
       NEXT_PUBLIC_AUCTION_ADDRESS=$AUCTION_ADDR
       NEXT_PUBLIC_ANONYMIZER_ADDRESS=$ANON_ADDR
       NEXT_PUBLIC_POOL_ADDRESS=$POOL
  2. Copy the addresses and the real transaction hashes into strk20.json.
  3. Update the README status table. Nothing in it should claim more than is true.
NOTE
