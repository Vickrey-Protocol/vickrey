/**
 * Submits the action shapes this client builds to the **live STRK20 pool** and checks
 * how far each one gets.
 *
 * `compile_actions` is a `view` on the pool, so this runs read-only: no wallet, no
 * signature, no funds, no deployment. It is not a substitute for a wallet actually
 * assembling and proving a transaction — but it is the pool contract itself accepting
 * or rejecting our encoding, which type-checking cannot tell us.
 *
 * The controls matter as much as the subject. If a deliberately malformed sequence
 * stops failing, this check has gone blind and proves nothing.
 *
 *   node client/scripts/verify-pool-shapes.mjs
 */
import { CairoCustomEnum, CallData, RpcProvider } from "starknet";
import { placeBidActions, claimActions } from "../src/strk20.ts";
import { AuctionOperation } from "../src/types.ts";
import { describe, resolveNetwork } from "../../scripts/lib/network.mjs";

/* RPC and POOL used to be independently overridable, so setting `STARKNET_RPC` to
   mainnet without also setting `POOL_ADDRESS` queried the *Sepolia* pool address on
   mainnet — a confident answer about a contract that is not there. They come from one
   network choice now, and either can still be overridden deliberately. */
const NET = resolveNetwork();
const RPC = process.env.STARKNET_RPC ?? NET.rpc;
const POOL = process.env.POOL_ADDRESS ?? NET.pool;
console.log(`  network    ${describe(NET)}`);
console.log(`  rpc        ${RPC}`);
console.log(`  pool       ${POOL}\n`);
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const USER = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde";
const HELPER = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

/** `ClientAction` is a Cairo custom enum: every variant present, one populated. */
const VARIANTS = [
  "SetViewingKey", "OpenChannel", "OpenSubchannel", "CreateEncNote", "CreateOpenNote",
  "Deposit", "UseNote", "Withdraw", "InvokeExternal", "ComputeAndInvoke",
];
const clientAction = (obj) =>
  new CairoCustomEnum(
    Object.fromEntries(VARIANTS.map((v) => [v, v in obj ? obj[v] : undefined])),
  );

/**
 * Translates a wallet-level `STRK20_ACTION` into the pool-level `ClientAction` the
 * wallet would produce. Doing it by hand here is the point: it is what lets us put
 * our own calldata in front of the real contract.
 */
function toClientActions(actions, { openNoteIndex = 0 } = {}) {
  return actions.map((a) => {
    switch (a.type) {
      case "withdraw":
        return clientAction({
          Withdraw: { to_addr: a.recipient, token: a.token, amount: BigInt(a.amount).toString(), random: "0x5eed" },
        });
      case "transfer":
        if (a.amount !== "OPEN") throw new Error("only OPEN transfers are modelled here");
        return clientAction({
          CreateOpenNote: {
            recipient_addr: a.recipient, recipient_public_key: "0x1",
            token: a.token, index: openNoteIndex, random: "0x1",
          },
        });
      case "invoke":
        return clientAction({
          InvokeExternal: {
            contract_address: a.contract,
            // The wallet resolves ${openNoteIds[N]} during assembly; stand in for it.
            calldata: a.calldata.map((c) => (c.startsWith("${") ? "0x1" : c)),
          },
        });
      default:
        throw new Error(`unmodelled action: ${a.type}`);
    }
  });
}

const bid = placeBidActions({
  helper: HELPER, paymentToken: STRK, collateral: 250n,
  auctionId: 7n, claimCommitment: 111n, upAnchor: 222n, downAnchor: 333n,
});
const claim = claimActions(AuctionOperation.ClaimRefund, {
  helper: HELPER, token: STRK, owner: USER, auctionId: 7n, bidIndex: 0, claimSecret: 99n,
});

/**
 * `expect` is the reason each case is here.
 *
 * - Our own shapes should fail on **state** (no notes, no subchannel for a throwaway
 *   user), which means the encoding, the variants and the phase order were accepted.
 * - The controls should fail on **shape**. If they ever stop, this file is lying.
 */
const CASES = [
  { name: "bid  [Withdraw, InvokeExternal]", actions: toClientActions(bid),
    expect: "NEGATIVE_INTERMEDIATE_BALANCE", why: "well-formed; the throwaway user has no notes to fund the withdraw" },
  { name: "claim [CreateOpenNote, Invoke]", actions: toClientActions(claim),
    expect: "SUBCHANNEL_NOT_FOUND", why: "well-formed; the throwaway user has no subchannel" },
  { name: "CONTROL reversed bid", actions: toClientActions([bid[1], bid[0]]),
    expect: "ACTIONS_OUT_OF_ORDER", why: "withdraw is phase 6, invoke is phase 7" },
  { name: "CONTROL invoke alone", actions: toClientActions([bid[1]]),
    expect: "NO_REPLAY_PROTECTION", why: "an invoke with no note action has no nullifier" },
  { name: "CONTROL two invokes", actions: toClientActions([bid[1], bid[1]]),
    expect: "ACTIONS_OUT_OF_ORDER", why: "at most one external invoke per transaction" },
];

const reason = (e) => {
  const m = String(e?.message ?? e).match(/'([A-Z0-9_]{3,60})'/g);
  return m ? m[m.length - 1].replaceAll("'", "") : String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 120);
};

const provider = new RpcProvider({ nodeUrl: RPC });
const abi = (await provider.getClassAt(POOL)).abi;
const cd = new CallData(abi);

console.log(`pool ${POOL}\nrpc  ${RPC}`);
console.log(`fee  ${(await provider.callContract({ contractAddress: POOL, entrypoint: "get_fee_amount", calldata: [] }))[0]} (wei of STRK, live)\n`);

let failed = 0;
for (const c of CASES) {
  const calldata = cd.compile("compile_actions", {
    user_addr: USER, user_private_key: "0x1", client_actions: c.actions,
  });
  let got;
  try {
    await provider.callContract({ contractAddress: POOL, entrypoint: "compile_actions", calldata });
    got = "ACCEPTED";
  } catch (e) {
    got = reason(e);
  }
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${c.name}`);
  console.log(`      got ${got}${ok ? "" : `, expected ${c.expect}`}`);
  console.log(`      ${c.why}\n`);
}

console.log(failed === 0
  ? "All shapes behave as expected against the live pool."
  : `${failed} case(s) diverged — the encoding or the pool has moved.`);
process.exit(failed === 0 ? 0 : 1);
