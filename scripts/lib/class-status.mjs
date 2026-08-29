/**
 * Says whether the class in a build artifact is already declared on a network.
 *
 *   node scripts/lib/class-status.mjs <rpc> <contract_class.json>
 *   -> "declared 0x…"   or   "absent 0x…"
 *
 * The class hash is computed from the artifact rather than scraped out of sncast's
 * output, so this answers the question the deploy actually has — "is *this* build
 * on chain?" — and not the weaker one sncast can answer, which is "did my declare
 * command happen to fail with a string containing the words already declared".
 *
 * Re-running a deploy after a partial failure is the normal case, not the exotic
 * one: a run that dies between the two declares should pick up where it stopped
 * rather than paying for the first one twice.
 *
 * **Point this at `target/release`.** `sncast declare` builds with Scarb's release
 * profile — verified by clearing `target/` and watching which directory it populates —
 * so the release artifact is what actually lands on chain. Checking the dev artifact
 * computes a hash that will never be declared, reports "absent" for a class that is
 * already there, and re-declares it. On mainnet that is 38 STRK paid twice.
 */
import { readFileSync } from "node:fs";
import { hash } from "starknet";

const [, , rpc, artifact] = process.argv;
const classHash = hash.computeContractClassHash(
  JSON.parse(readFileSync(artifact, "utf8")),
);

const r = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "starknet_getClass",
    params: { block_id: "latest", class_hash: classHash },
  }),
});
const j = await r.json();

if (j.result) {
  console.log(`declared ${classHash}`);
} else if (j.error?.message?.toLowerCase().includes("class hash not found")) {
  console.log(`absent ${classHash}`);
} else {
  // Anything else — a node that is down, rate-limiting, or answering nonsense — must
  // not be read as "absent", because that would spend money re-declaring.
  console.error(`cannot determine class status: ${JSON.stringify(j.error)}`);
  process.exit(1);
}
