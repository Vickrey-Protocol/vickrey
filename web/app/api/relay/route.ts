/**
 * The relay: posts a bidder's reveal or dispute from the site's own account, so the
 * bidder's wallet is never attached to the bid it concerns.
 *
 * What it can and cannot do. A reveal arrives already encrypted to the auctioneer; a
 * dispute's arguments are exactly what the contract publishes when it opens a reveal. So
 * the relay learns nothing a chain reader would not, holds no bidder secret, and cannot
 * change what it posts — the contract checks every byte. The worst it can do is not post,
 * and the page always offers posting it yourself.
 *
 * What it costs. Gas, from a hot wallet. So it simulates every call first and sends only
 * what would succeed — a garbage reveal still succeeds (posting is permissionless), which
 * is why it is also rate-limited per address and capped per bid.
 *
 * Off unless `RELAY_ADDRESS`, `RELAY_PRIVATE_KEY` and `NEXT_PUBLIC_RELAY=on` are all set.
 */
import { NextResponse } from "next/server";
import { Account, RpcProvider, num } from "starknet";
import { config } from "@/lib/config";

const ADDRESS = process.env.RELAY_ADDRESS ?? "";
const KEY = process.env.RELAY_PRIVATE_KEY ?? "";
const ENABLED = config.relay && !!ADDRESS && !!KEY && !!config.auctionAddress;

/* Per-instance limits. Serverless instances do not share them, which loosens the cap
   but never removes it; the contract's own checks are what keep a post honest. */
const perIp = new Map<string, number[]>();
const perBid = new Map<string, number>();
const IP_PER_HOUR = 30;
const PER_BID = 3;

const felt = (x: unknown) => {
  if (typeof x !== "string" && typeof x !== "number") throw new Error("bad field");
  const v = BigInt(x);
  if (v < 0n || v >= 2n ** 252n) throw new Error("out of range");
  return num.toHex(v);
};

export async function POST(request: Request) {
  if (!ENABLED) {
    return NextResponse.json({ error: "the relay is not configured on this site" }, { status: 503 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= IP_PER_HOUR) {
    return NextResponse.json({ error: "too many requests from this address — post it yourself" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  let calldata: string[];
  let entrypoint: "post_reveal" | "dispute";
  try {
    const head = [felt(body.auctionId), felt(body.bidIndex)];
    if (body.kind === "reveal") {
      entrypoint = "post_reveal";
      calldata = [...head, felt(body.ephX), felt(body.cSeed), felt(body.cLevel)];
    } else if (body.kind === "dispute") {
      entrypoint = "dispute";
      calldata = [...head, felt(body.r), felt(body.cSeed), felt(body.cLevel)];
    } else {
      return NextResponse.json({ error: "kind must be reveal or dispute" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }

  const bidKey = `${entrypoint}:${calldata[0]}:${calldata[1]}`;
  if ((perBid.get(bidKey) ?? 0) >= PER_BID) {
    return NextResponse.json({ error: "already posted for this bid — post it yourself if it is missing" }, { status: 429 });
  }

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({ provider, address: ADDRESS, signer: KEY });
  const call = { contractAddress: config.auctionAddress, entrypoint, calldata };
  try {
    /* Simulated first: a call that would revert is never paid for. */
    await provider.callContract(call);
  } catch (e) {
    const why = e instanceof Error ? (e.message.match(/'([A-Z0-9_]{4,31})'/g)?.pop() ?? "it would revert") : "it would revert";
    return NextResponse.json({ error: `not sent: ${why}` }, { status: 422 });
  }
  try {
    const { transaction_hash } = await account.execute(call);
    perIp.set(ip, [...recent, now]);
    perBid.set(bidKey, (perBid.get(bidKey) ?? 0) + 1);
    return NextResponse.json({ tx: transaction_hash });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "send failed" }, { status: 502 });
  }
}
