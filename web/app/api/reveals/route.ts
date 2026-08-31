/**
 * The reveal relay — a demo convenience, and off in production.
 *
 * After sealing, a bidder POSTs `{auctionId, index, seed, level}` here and the auctioneer
 * GETs them back by auction id. That is the whole mechanism: an in-memory `Map` on a
 * serverless instance, no database, no queue.
 *
 * **Its previous description of itself was wrong**, and in the direction that matters.
 * It claimed "the worst it can do is withhold a reveal". The worst it can do is publish
 * every bid: `GET /api/reveals?auctionId=N` had no authentication of any kind, so anyone
 * who guessed an id — they are sequential integers — could read the exact level of every
 * revealed bid, in plaintext, for as long as the instance lived. On a site whose central
 * claim is that losing bids are never published, that is the claim itself.
 *
 * So it is disabled unless `REVEAL_RELAY=on`, and it is not set in production. Both
 * handlers refuse with an explanation and the UI falls back to the path that was always
 * the durable one: the bidder copies the reveal as text and sends it to the auctioneer
 * over a channel they choose, and the auctioneer console pastes it in. That path is
 * already built and already used, because a serverless `Map` cannot survive a cold start
 * either.
 *
 * What remains true of it when enabled:
 *
 * - It only ever holds reveals, and only after the on-chain `Sealed` event, so it cannot
 *   see a bid before the set is frozen.
 * - Every reveal is re-checked against the anchors the chain stores (`revealMatches`),
 *   so a tampered or invented one is forfeited rather than believed.
 * - It never sees a `claimSecret` and so can never move anyone's money.
 *
 * The proper fix, if it is ever to be on in production, is to authenticate the read: the
 * auctioneer signs a challenge, and the route verifies it against the auction's
 * `auctioneer` address via `is_valid_signature`. That is not built. Until it is, this
 * stays off.
 */
import { NextResponse } from "next/server";

/** Opt-in, and deliberately absent from the production environment. */
const ENABLED = process.env.REVEAL_RELAY === "on";

const off = () =>
  NextResponse.json(
    {
      error: "The reveal relay is disabled.",
      why: "It had no authentication on reads, so anyone could have read every revealed "
        + "bid amount by auction id. Send your reveal to the auctioneer over a channel "
        + "you trust — the bid screen will copy it for you — and the auctioneer console "
        + "accepts it pasted in.",
    },
    { status: 503 },
  );

interface StoredReveal {
  auctionId: string;
  index: number;
  seed: string;
  level: number;
  at: number;
}

const store = new Map<string, Map<number, StoredReveal>>();

export async function POST(request: Request) {
  if (!ENABLED) return off();
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
  if (!ENABLED) return off();
  const auctionId = new URL(request.url).searchParams.get("auctionId");
  if (!auctionId) return NextResponse.json({ error: "auctionId required" }, { status: 400 });
  const forAuction = store.get(auctionId);
  return NextResponse.json({ reveals: forAuction ? [...forAuction.values()] : [] });
}
