#!/usr/bin/env bash
#
# Deploys the §6a rig: a stand-in pool and an anonymizer wired to it.
#
#   scripts/deploy-mock-pool.sh <network> <sncast-account> <auction-address>
#
# `MockPrivacyPool` drives `privacy_invoke` the way the real pool does, so this
# exercises the real AuctionAnonymizer and the real SealedBidAuction on chain — the
# half of the pool leg that can force a Cairo change, without needing a wallet that
# speaks STRK20.
#
# Sepolia only by intent. Nothing here belongs on mainnet: the helper it deploys trusts
# a pool we control, which is the whole point in a test and a vulnerability in
# production.
set -euo pipefail

NETWORK="${1:?network required}"
ACCOUNT="${2:?sncast account required}"
AUCTION="${3:?auction address required}"

[ "$NETWORK" = "sepolia" ] || {
  echo "refusing: this rig is Sepolia-only. The helper it deploys trusts a pool we" >&2
  echo "control, which is a test fixture and would be a live vulnerability." >&2
  exit 1
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RPC="https://api.cartridge.gg/x/starknet/sepolia"
cast() { sncast --account "$ACCOUNT" "$@" --url "$RPC"; }
field() { sed -n "s/^$1: *\(0x[0-9a-fA-F]*\).*/\1/p" | head -1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Building"; scarb build

declare_class() {
  local name="$1" pkg="$2" artifact="$3" status
  status="$(node scripts/lib/class-status.mjs "$RPC" "$artifact")"
  if [ "${status%% *}" = declared ]; then echo "${status#* }"; return; fi
  cast declare --contract-name "$name" --package "$pkg" >/dev/null 2>&1 || true
  node scripts/lib/class-status.mjs "$RPC" "$artifact" | cut -d' ' -f2
}

say "Declaring MockPrivacyPool"
POOL_CLASS="$(declare_class MockPrivacyPool anonymizer \
  target/dev/anonymizer_MockPrivacyPool.contract_class.json)"
echo "  class_hash = $POOL_CLASS"

say "Declaring AuctionAnonymizer"
ANON_CLASS="$(declare_class AuctionAnonymizer anonymizer \
  target/dev/anonymizer_AuctionAnonymizer.contract_class.json)"
echo "  class_hash = $ANON_CLASS"

say "Deploying MockPrivacyPool"
POOL="$(cast deploy --class-hash "$POOL_CLASS" | field 'Contract Address')"
[ -n "$POOL" ] || { echo "no pool address" >&2; exit 1; }
echo "  address = $POOL"

say "Deploying an anonymizer wired to it"
HELPER="$(cast deploy --class-hash "$ANON_CLASS" \
  --constructor-calldata "$POOL" "$AUCTION" | field 'Contract Address')"
[ -n "$HELPER" ] || { echo "no helper address" >&2; exit 1; }
echo "  address = $HELPER"

cat <<NOTE

Run §6a:
  AUCTION=$AUCTION MOCK_POOL=$POOL HELPER=$HELPER NETWORK=sepolia \\
    node scripts/verify-events.mjs
NOTE
