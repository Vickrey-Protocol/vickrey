/**
 * The client side of `/api/relay`, which posts a bidder's reveal or dispute from the
 * site's own account so the bidder's wallet is not attached to it.
 *
 * The relay holds no secret of the bidder's: a reveal is already encrypted to the
 * auctioneer, and a dispute's arguments are exactly what the contract publishes when it
 * opens the reveal. It can fail to post; it cannot post something different. The panel
 * always offers posting it yourself.
 */
import { config } from "@/lib/config";

export type RelayRequest =
  | { kind: "reveal"; auctionId: string; bidIndex: number; ephX: string; cSeed: string; cLevel: string }
  | { kind: "dispute"; auctionId: string; bidIndex: number; r: string; cSeed: string; cLevel: string };

export type RelayResult = { ok: true; tx: string } | { ok: false; why: string };

export async function relay(req: RelayRequest): Promise<RelayResult> {
  if (!config.relay) return { ok: false, why: "the relay is not configured on this site" };
  try {
    const res = await fetch("/api/relay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as { tx?: string; error?: string; already?: boolean };
    if (res.ok && (body.tx || body.already)) return { ok: true, tx: body.tx ?? "" };
    return { ok: false, why: body.error ?? `the relay answered ${res.status}` };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : "no response" };
  }
}
