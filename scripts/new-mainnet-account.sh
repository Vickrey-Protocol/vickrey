#!/usr/bin/env bash
#
# Creates a dedicated mainnet deploy account, separate from any wallet used for
# anything else.
#
#   scripts/new-mainnet-account.sh create     # makes a key, prints the address to fund
#   scripts/new-mainnet-account.sh deploy     # after funding, deploys it on chain
#
# Why a dedicated account: the key only ever needs to declare and deploy, it can hold
# exactly the run's cost and nothing else, and it can be discarded afterwards. A key
# that never had anything else in it is a key you can afford to be relaxed about.
#
# What it CANNOT do: the pool leg. Private-rail transactions are proved inside the
# wallet, so the three qualifying pool transactions must come from a browser wallet
# with STRK20 support. Fund both. See docs/mainnet.md.
set -euo pipefail

CMD="${1:?usage: new-mainnet-account.sh create|deploy}"
RPC="https://api.cartridge.gg/x/starknet/mainnet"
NAME="vickrey-deploy"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$CMD" in
  create)
    sncast account create --name "$NAME" --type oz --url "$RPC"
    cat <<NOTE

  Next:
    1. Send 90 STRK to the address above. It must be there before the account can be
       deployed — the deployment pays its own fee out of the account.
    2. scripts/new-mainnet-account.sh deploy
    3. scripts/deploy.sh mainnet $NAME

  90 covers the 61.6 the first declare must hold and the ~46.6 the whole contract
  bring-up spends, with room for gas movement. Keep the rest in your own wallet for the
  pool leg, which this account cannot do.
NOTE
    ;;
  deploy)
    sncast account deploy --name "$NAME" --url "$RPC"
    echo
    echo "  Deployed. Verify with a read-only preflight that spends nothing:"
    echo "      scripts/deploy.sh mainnet $NAME"
    ;;
  *) echo "unknown command: $CMD (create | deploy)" >&2; exit 1 ;;
esac
