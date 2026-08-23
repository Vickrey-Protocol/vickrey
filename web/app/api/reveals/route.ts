/**
 * The reveal relay.
 *
 * After sealing, a bidder posts `{index, seed, level}` here and the auctioneer reads
 * it. **This relay is untrusted by construction** and worth being precise about:
 *
 * - It only ever holds reveals, and only after the on-chain `Sealed` event. It cannot
 *   see a bid before the set is frozen, which is the whole point of the seal.
 * - Every reveal it hands over is re-checked against the anchors the chain stores
 *   (`revealMatches`). A tampered or invented reveal is forfeited, not believed.
 * - It never sees a `claimSecret`, so it can never move anyone's money.
 *
 * The worst it can do is withhold a reveal, which forfeits that bid — recoverable by
 * the bidder through `redeem_forfeit`, and disputable if it changed the outcome.
 *
 * **In-memory, and not durable in production.** On serverless each invocation may hit
 * a different instance, so a reveal posted here can vanish before the auctioneer
 * collects it. That is why it is a convenience and not a dependency: the bidder UI can
 * emit the same payload as text, and the auctioneer console accepts pasted reveals.
 * A demo that a cold start can break is not a demo.
 */
import { NextResponse } from "next/server";

interface StoredReveal {
  auctionId: string;
  index: number;
  seed: string;
  level: number;
  at: number;
}

const store = new Map<string, Map<number, StoredReveal>>();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { auctionId, index, seed, level } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof auctionId !== "string" ||
    typeof seed !== "string" ||
    !Number.isInteger(index) ||
    !Number.isInteger(level)
  ) {
    return NextResponse.json(
      { error: "expected { auctionId: string, index: int, seed: string, level: int }" },
      { status: 400 },
    );
  }
  try {
    BigInt(auctionId);
    BigInt(seed);
  } catch {
    return NextResponse.json({ error: "auctionId and seed must be integers" }, { status: 400 });
  }

  const forAuction = store.get(auctionId) ?? new Map<number, StoredReveal>();
  forAuction.set(index as number, {
    auctionId,
    index: index as number,
    seed,
    level: level as number,
    at: Date.now(),
  });
  store.set(auctionId, forAuction);

  return NextResponse.json({ ok: true, count: forAuction.size });
}

export async function GET(request: Request) {
  const auctionId = new URL(request.url).searchParams.get("auctionId");
  if (!auctionId) return NextResponse.json({ error: "auctionId required" }, { status: 400 });
  const forAuction = store.get(auctionId);
  return NextResponse.json({ reveals: forAuction ? [...forAuction.values()] : [] });
}
