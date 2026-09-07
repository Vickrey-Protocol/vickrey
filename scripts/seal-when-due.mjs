/**
 * Waits for an auction's bid deadline and seals it the moment it passes.
 *
 *   AUCTION_ID=1 node scripts/seal-when-due.mjs
 *
 * `seal` is permissionless by design — the contract checks only that the deadline has
 * passed — so this runs from the deploy account without needing the auctioneer. That
 * permissionlessness is the point: an auctioneer who could stall sealing could wait for
 * a book that suited them.
 *
 * It polls chain time rather than wall time, because the contract compares against
 * `get_block_timestamp()` and a local clock that disagrees would either seal early
 * (reverting on BIDDING_STILL_OPEN) or sit idle after the deadline had actually passed.
 */
import { readFileSync } from "node:fs";
import { Account, RpcProvider, num } from "starknet";

const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const AUCTION = "0x02d893acf290c61be4afb6999d6fa39244fba514267c1ccea9e124af64bb6831";
const ID = BigInt(process.env.AUCTION_ID ?? 1);

const ks = JSON.parse(readFileSync(process.env.HOME + "/.starknet_accounts/starknet_open_zeppelin_accounts.json", "utf8"));
const me = ks["alpha-mainnet"]["vickrey-deploy"];
const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({ provider, address: me.address, signer: me.private_key });
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const cfg = await provider.callContract({ contractAddress: AUCTION, entrypoint: "get_config", calldata: [num.toHex(ID)] });
/* bid_deadline is the 10th field of AuctionConfig: seller, auctioneer, payment_token,
   lot_token, lot_amount(u128=1 felt), kind, reserve_price, tick, num_levels, … */
const deadline = Number(BigInt(cfg[9]));
console.log(`${stamp()}  auction #${ID}  bid deadline ${new Date(deadline * 1000).toISOString()}`);

for (;;) {
  const st = await provider.callContract({ contractAddress: AUCTION, entrypoint: "get_state", calldata: [num.toHex(ID)] });
  const status = Number(BigInt(st[0]));
  if (status !== 1) { console.log(`${stamp()}  status is ${status}, not Open — nothing to seal`); break; }
  const blk = await provider.getBlock("latest");
  const now = Number(blk.timestamp);
  if (now >= deadline) {
    console.log(`${stamp()}  chain time ${now} >= ${deadline} — sealing`);
    try {
      const { transaction_hash } = await account.execute([
        { contractAddress: AUCTION, entrypoint: "seal", calldata: [num.toHex(ID)] },
      ]);
      const r = await provider.waitForTransaction(transaction_hash, { retryInterval: 3000 });
      const ok = (r.execution_status ?? r.statusReceipt) !== "REVERTED";
      console.log(`${stamp()}  seal ${transaction_hash} ${ok ? "OK" : "REVERTED"}`);
      console.log(`  https://starkscan.co/tx/${transaction_hash}`);
      if (!ok) console.log(JSON.stringify(r).slice(0, 500));
    } catch (e) { console.log(`${stamp()}  seal threw: ${String(e).slice(0, 300)}`); }
    break;
  }
  console.log(`${stamp()}  ${Math.ceil((deadline - now) / 60)} min to go (chain time ${now})`);
  await new Promise((r) => setTimeout(r, 30000));
}
