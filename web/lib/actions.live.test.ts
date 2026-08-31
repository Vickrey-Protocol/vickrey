/**
 * What the queue would show, computed from the live chain rather than from fixtures.
 *
 * Not part of the suite — it needs the network, and a unit test that fails because
 * Sepolia is slow trains people to ignore a red mark. It exists to observe a real run:
 * point it at a real auction, and it reports what `actionsFor` produces for each party
 * from the state actually on chain, using the same function the dashboard uses.
 *
 *   AUCTION_ADDRESS=0x… AUCTION_ID=8 SELLER=0x… \
 *     npx vitest run --config vitest.config.ts --include "**\/*.live.test.ts"
 *
 * The point is that it is the real code path. Transcribing the rules into an observation
 * script would produce a second implementation that can agree with itself while
 * disagreeing with the app.
 */
import { describe, expect, it } from "vitest";
import { RpcProvider } from "starknet";
import { Status } from "@vickrey/client";
import { actionsFor } from "@/lib/actions";
import type { AuctionView } from "@/lib/chain";
import type { StoredBid } from "@/lib/vault";

const RPC = process.env.RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const ADDR = process.env.AUCTION_ADDRESS ?? "";
const ID = process.env.AUCTION_ID ?? "0";
const utc = (t: number) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";

const p = new RpcProvider({ nodeUrl: RPC });
const n = (x: string) => BigInt(x);

async function live(): Promise<AuctionView> {
  const call = (fn: string, cd: string[] = []) =>
    p.callContract({ contractAddress: ADDR, entrypoint: fn, calldata: cd });
  const cfg = await call("get_config", [ID]);
  const st = await call("get_state", [ID]);
  return {
    terms: { auctionId: BigInt(ID), kind: Number(n(cfg[5]!)), reservePrice: n(cfg[6]!),
             tick: n(cfg[7]!), numLevels: Number(n(cfg[8]!)) },
    status: Number(n(st[0]!)) as Status,
    seller: "0x" + n(cfg[0]!).toString(16),
    auctioneer: "0x" + n(cfg[1]!).toString(16),
    paymentToken: "0x" + n(cfg[2]!).toString(16), paymentSymbol: "STRK", paymentDecimals: 18,
    lotToken: "0x" + n(cfg[3]!).toString(16), lotSymbol: "LOT", lotDecimals: 18,
    lotAmount: n(cfg[4]!),
    bidDeadline: Number(n(cfg[9]!)), disputeWindow: Number(n(cfg[10]!)),
    disputeDeadline: Number(n(st[8]!)), sealedAtTime: Number(n(st[4]!)),
    bidCount: Number(n(st[1]!)), bidRoot: n(st[2]!),
    clearingLevel: Number(n(st[6]!)), winnerIndex: Number(n(st[7]!)),
    collateral: 0n, bond: n(cfg[11]!), lotClaimed: false, poolFee: null,
  } as AuctionView;
}

describe("live auction — what each party's queue shows right now", () => {
  it("reports the stage and every party's actions", async () => {
    expect(ADDR, "set AUCTION_ADDRESS").not.toBe("");
    const a = await live();
    const now = Math.floor(Date.now() / 1000);
    const graceEnds = a.sealedAtTime > 0 ? a.sealedAtTime + a.disputeWindow : null;

    console.log(`\n  auction #${ID}  status ${Status[a.status] ?? a.status}  bids ${a.bidCount}`);
    console.log(`  now            ${utc(now)}`);
    console.log(`  bid deadline   ${utc(a.bidDeadline)}  ${now >= a.bidDeadline ? "(passed)" : "(future)"}`);
    if (a.sealedAtTime) console.log(`  sealed at      ${utc(a.sealedAtTime)}`);
    if (graceEnds) {
      console.log(`  grace / settle-by ${utc(graceEnds)}  ${now >= graceEnds ? "(OPEN — abandon callable)" : `(${graceEnds - now}s left)`}`);
    }
    if (a.disputeDeadline) {
      console.log(`  dispute closes ${utc(a.disputeDeadline)}  ${now >= a.disputeDeadline ? "(closed)" : `(${a.disputeDeadline - now}s left)`}`);
    }
    console.log(`  winner index   ${a.winnerIndex}   clearing level ${a.clearingLevel}`);

    /* One stored bid per on-chain bid, so every bidder-side path is exercised. Indexes
       are what the queue matches on; the secrets are irrelevant to what it offers. */
    const mine = (i: number): StoredBid[] => [{
      auctionId: ID, index: i, level: 0, claimSecret: "1", seed: "1",
      claimCommitment: "1", upAnchor: "1", downAnchor: "1",
    }];

    const show = (who: string, addr: string, bids: StoredBid[]) => {
      const acts = actionsFor([a], bids, addr, now);
      console.log(`\n  ${who}`);
      if (!acts.length) console.log("    (nothing)");
      for (const x of acts) {
        const when = x.deadline === null
          ? (x.blocking ? "HOLDING ASSETS, no clock" : "no deadline")
          : `${utc(x.deadline)} (${x.deadlineKind})`;
        console.log(`    ${x.kind.padEnd(13)} as ${x.role.padEnd(10)} ${when}`);
      }
      return acts;
    };

    show("seller / auctioneer", a.seller, []);
    for (let i = 0; i < Math.min(a.bidCount, 3); i++) {
      show(`bidder holding bid #${i}`, "0xdeadbeef", mine(i));
    }
    console.log("");
  }, 60_000);
});
