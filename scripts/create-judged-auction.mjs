/**
 * Creates the judged mainnet auction and stops. It does not bid, seal or settle.
 *
 * live-auction.mjs runs a whole lifecycle with direct contract calls, which is the
 * wrong shape here: the three qualifying bids must arrive through the STRK20 pool from
 * a browser wallet, so the auction has to be created and then left open.
 *
 * Two approvals, not one. The lot and the payment are different tokens here — VLOT in,
 * STRK out — so the contract pulls from two ERC-20s and each needs its own allowance.
 * A single approve is the bug the two-token form was built to make impossible.
 */
import { readFileSync } from "node:fs";
import { Account, CallData, RpcProvider, num, shortString } from "starknet";

const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const AUCTION = "0x02d893acf290c61be4afb6999d6fa39244fba514267c1ccea9e124af64bb6831";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const VLOT = "0x06593745d3fdcf7f50d3d49a0eebfad43d08ec37d7cdff87e33c26017957f62b";

/* The ladder is sized by the shielded balance, not by taste. Collateral is derived —
   cap_price = reserve + tick*(levels-1) — so three bids cost 3*cap, and 1 STRK is
   shielded. 0.03/0.03/8 puts the cap at 0.24 and three bids at 0.72, leaving 0.28
   spare rather than spending a second 6 STRK pool fee to shield more. */
const RESERVE = 30000000000000000n;   // 0.03 STRK
const TICK    = 30000000000000000n;   // 0.03 STRK
const LEVELS  = 8;
const CAP     = RESERVE + TICK * BigInt(LEVELS - 1);   // 0.24 STRK
const LOT     = 10000000000n;         // 100 VLOT at 8 decimals
const BOND    = TICK;                 // the minimum the contract accepts: >= tick, <= cap
const WINDOW  = 86400;                // production value
const DEADLINE = Math.floor(Date.now() / 1000) + Number(process.env.BID_MINUTES ?? 90) * 60;

const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const me = ks["alpha-mainnet"]?.["vickrey-deploy"];
if (!me) throw new Error("no vickrey-deploy account in the sncast keystore");
const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });

const strk = (w) => (Number(w) / 1e18).toFixed(4);
console.log(`  network      mainnet`);
console.log(`  auction      ${AUCTION}`);
console.log(`  seller       ${me.address}`);
console.log(`  lot          100 VLOT (8dp)   ${VLOT}`);
console.log(`  payment      STRK (18dp)`);
console.log(`  ladder       ${strk(RESERVE)} .. ${strk(CAP)} in ${LEVELS} levels of ${strk(TICK)}`);
console.log(`  collateral   ${strk(CAP)} STRK per bid  →  3 bids = ${strk(CAP * 3n)} STRK of the 1.0 shielded`);
console.log(`  bond         ${strk(BOND)} STRK`);
console.log(`  bidding ends ${new Date(DEADLINE * 1000).toISOString()}   dispute window ${WINDOW}s (24h)\n`);

const config = CallData.compile([
  me.address, me.address, STRK, VLOT,
  num.toHex(LOT), "0x1",                                  // lot_amount, kind = Vickrey
  num.toHex(RESERVE), num.toHex(TICK), num.toHex(LEVELS),
  num.toHex(DEADLINE), num.toHex(WINDOW), num.toHex(BOND),
  shortString.encodeShortString("VICKREY MAINNET 1"),
]);

const { transaction_hash } = await account.execute([
  { contractAddress: VLOT, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(LOT), "0x0"]) },
  { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(BOND), "0x0"]) },
  { contractAddress: AUCTION, entrypoint: "create_auction", calldata: config },
]);
process.stdout.write(`  create  ${transaction_hash}  `);
const r = await provider.waitForTransaction(transaction_hash, { retryInterval: 3000 });
const ok = (r.execution_status ?? r.statusReceipt) !== "REVERTED";
console.log(ok ? "OK" : "REVERTED");
if (!ok) { console.log(JSON.stringify(r).slice(0, 700)); process.exit(1); }

const count = await provider.callContract({ contractAddress: AUCTION, entrypoint: "auction_count", calldata: [] });
const id = BigInt(count[0]) - 1n;
const coll = await provider.callContract({ contractAddress: AUCTION, entrypoint: "collateral", calldata: [num.toHex(id)] });
console.log(`\n  auction id   ${id}`);
console.log(`  collateral read back from chain: ${strk(BigInt(coll[0]))} STRK`);
console.log(`  https://starkscan.co/tx/${transaction_hash}`);
