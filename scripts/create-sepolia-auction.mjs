/**
 * Creates one Sepolia auction on the FROZEN class and stops. Mirrors
 * create-judged-auction.mjs, but on Sepolia, from account_ready, with STRK as both lot
 * and payment (the two-token form is exercised by the mainnet run; here the point is the
 * vault and both rails, on the same contract code that is live on mainnet).
 *
 *   BID_MINUTES=45 DISPUTE_SECONDS=3600 node scripts/create-sepolia-auction.mjs
 */
import { readFileSync } from "node:fs";
import { Account, CallData, RpcProvider, num, shortString } from "starknet";
const RPC = "https://api.cartridge.gg/x/starknet/sepolia";
const AUCTION = "0x0496dde31ec488f340fd21e4533206a8b0d36becd314728b8c212dcbf48c30d9";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RESERVE = 30000000000000000n, TICK = 30000000000000000n, LEVELS = 8;   // 0.03 .. 0.24, as mainnet
const CAP = RESERVE + TICK * BigInt(LEVELS - 1);
const LOT = 1000000000000000000n;            // 1 STRK, the thing being sold
const BOND = TICK;
const WINDOW = Number(process.env.DISPUTE_SECONDS ?? 3600);
const DEADLINE = Math.floor(Date.now() / 1000) + Number(process.env.BID_MINUTES ?? 45) * 60;
const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const me = ks["alpha-sepolia"]?.["account_ready"]; if (!me) throw new Error("no account_ready in keystore");
const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });
const strk = (w) => (Number(w) / 1e18).toFixed(4);
console.log(`  network  sepolia   auction ${AUCTION}\n  seller   ${me.address}\n  lot      ${strk(LOT)} STRK   ladder ${strk(RESERVE)}..${strk(CAP)} × ${LEVELS}   collateral ${strk(CAP)} STRK/bid   bond ${strk(BOND)}\n  bidding ends ${new Date(DEADLINE*1000).toISOString()}   dispute ${WINDOW}s`);
const cfg = CallData.compile([
  me.address, me.address, STRK, STRK, num.toHex(LOT), "0x1",
  num.toHex(RESERVE), num.toHex(TICK), num.toHex(LEVELS), num.toHex(DEADLINE), num.toHex(WINDOW), num.toHex(BOND),
  /* terms_hash: the 13th AuctionConfig field. The contract never interprets it, but it
     is part of the struct and omitting it silently shifts nothing — Serde would simply
     run out of calldata and revert. */
  shortString.encodeShortString(process.env.LABEL ?? "VICKREY SEPOLIA LC")]);
const before = Number(BigInt((await provider.callContract({ contractAddress: AUCTION, entrypoint: "auction_count", calldata: [] }))[0]));
const { transaction_hash } = await account.execute([
  { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([AUCTION, num.toHex(LOT + BOND), "0x0"]) },
  { contractAddress: AUCTION, entrypoint: "create_auction", calldata: cfg },
]);
const r = await provider.waitForTransaction(transaction_hash);
console.log(`  create   ${transaction_hash}  ${r.execution_status}`);
console.log(`  auction id ${before}   https://sepolia.voyager.online/tx/${transaction_hash}`);
