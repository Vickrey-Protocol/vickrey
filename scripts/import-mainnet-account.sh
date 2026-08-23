#!/usr/bin/env bash
#
# Imports an existing funded mainnet account into the sncast keystore.
#
#   scripts/import-mainnet-account.sh <address> [/path/to/keyfile]
#
# Run with just the address first: it identifies the wallet from the deployed class
# hash, reports the balance, and tells you the exact second command. Nothing is written
# and no key is needed for that pass.
#
# The private key is read from a FILE, never an argument — a key on a command line
# lands in shell history and in the process list, where it is readable by anything else
# running as you.
set -euo pipefail

ADDR="${1:?usage: import-mainnet-account.sh <address> [keyfile]}"
KEYFILE="${2:-}"
RPC="https://api.cartridge.gg/x/starknet/mainnet"
NAME="vickrey-mainnet"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node - "$RPC" "$ADDR" <<'NODE'
const [, , rpc, addr] = process.argv;
const { hash } = await import("starknet");
const call = async (method, params) => {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
};

let cls;
try {
  cls = await call("starknet_getClassHashAt", { block_id: "latest", contract_address: addr });
} catch {
  console.error(`\n  Nothing is deployed at ${addr} on mainnet.`);
  console.error(`  Check the address, and check it is the mainnet one — Sepolia and`);
  console.error(`  mainnet addresses look identical and are not interchangeable.\n`);
  process.exit(1);
}

/* Known account classes. An unrecognised hash is not an error — it just means you have
   to say which wallet it is, because sncast needs the type to sign correctly. */
const KNOWN = {
  "0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f": "ready",
  "0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003": "ready",
  "0x540d7f5ec7ecf317e68d48564934cb99259781b1ee3cedbbc37ec5337f8e688": "oz",
  "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c": "braavos",
  "0x3957f9f5a1cbfe918cedc2fa702d8492de51c1b0d1badb7db4a7f0dbd0d9e0e": "braavos",
};
const type = KNOWN[cls] ?? KNOWN["0x" + BigInt(cls).toString(16)] ?? null;

const bal = await call("starknet_call", {
  request: {
    contract_address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    entry_point_selector: hash.getSelectorFromName("balanceOf"),
    calldata: [addr],
  }, block_id: "latest",
});
const strk = Number(BigInt(bal[0]) + (BigInt(bal[1] ?? 0) << 128n)) / 1e18;

console.log(`\n  address     ${addr}`);
console.log(`  deployed    yes`);
console.log(`  class hash  ${cls}`);
console.log(`  wallet      ${type ?? "UNRECOGNISED — tell me which wallet this is"}`);
console.log(`  balance     ${strk.toFixed(2)} STRK`);

const NEED = 61.6;
if (strk < NEED) {
  console.log(`\n  Short for the declare: it must hold ${NEED} STRK and holds ${strk.toFixed(2)}.`);
  console.log(`  Top up to 90 before Wednesday. See docs/mainnet.md.`);
}
console.log(`\n  type=${type ?? "UNKNOWN"}`);
NODE

TYPE="$(node -e "
const K={'0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f':'ready',
'0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003':'ready',
'0x540d7f5ec7ecf317e68d48564934cb99259781b1ee3cedbbc37ec5337f8e688':'oz',
'0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c':'braavos',
'0x3957f9f5a1cbfe918cedc2fa702d8492de51c1b0d1badb7db4a7f0dbd0d9e0e':'braavos'};
(async()=>{const r=await fetch('$RPC',{method:'POST',headers:{'content-type':'application/json'},
body:JSON.stringify({jsonrpc:'2.0',id:1,method:'starknet_getClassHashAt',params:{block_id:'latest',contract_address:'$ADDR'}})});
const j=await r.json();const c=j.result?'0x'+BigInt(j.result).toString(16):'';process.stdout.write(K[c]??'');})();" 2>/dev/null)"

if [ -z "$KEYFILE" ]; then
  echo
  echo "  Read-only so far. Nothing has been written."
  echo
  if [ -z "$TYPE" ]; then
    echo "  I could not identify the wallet from its class hash. Tell me which one it is"
    echo "  and I will add it to the table; sncast needs the type to sign correctly."
  else
    echo "  To import, put the private key in a file on its own and run:"
    echo
    echo "      umask 077; printf '%s' '<PRIVATE_KEY>' > /tmp/k.txt"
    echo "      scripts/import-mainnet-account.sh $ADDR /tmp/k.txt"
    echo
    echo "  The script shreds the file afterwards. The key never enters your shell"
    echo "  history and never appears on a command line."
  fi
  exit 0
fi

[ -f "$KEYFILE" ] || { echo "no such key file: $KEYFILE" >&2; exit 1; }
[ -n "$TYPE" ] || { echo "unrecognised account class — cannot pick a type" >&2; exit 1; }

sncast account import \
  --name "$NAME" --address "$ADDR" --type "$TYPE" \
  --private-key-file "$KEYFILE" --url "$RPC" --silent

# The key has served its purpose. Leaving it in /tmp is how it ends up in a backup.
rm -P "$KEYFILE" 2>/dev/null || rm -f "$KEYFILE"
echo
echo "  Imported as '$NAME', key file removed."
echo "  Verify, spending nothing:"
echo "      scripts/deploy.sh mainnet $NAME     # refuses if the balance is under the bound"
