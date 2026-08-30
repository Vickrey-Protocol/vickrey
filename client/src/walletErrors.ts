/**
 * Reading a Wallet API error, and saying something a person can act on.
 *
 * Two problems, and the first one hides the second.
 *
 * **The code was being thrown away.** Callers did `e instanceof Error ? e.message :
 * String(e)`. JSON-RPC errors arrive as plain objects — `{ code, message, data }` — which
 * are not `Error` instances, so `String(e)` produced `[object Object]` and the numeric
 * code, the only part with any information in it, was discarded before anyone could read
 * it. Evidence was being destroyed at the point of capture.
 *
 * **And the spec's messages say nothing.** Every error in Wallet API 0.10.3 has the same
 * form:
 *
 *     NOT_REGISTERED (118)   'An error occurred (NOT_REGISTERED)'
 *     UNKNOWN_ERROR  (163)   'An error occurred (UNKNOWN_ERROR)'
 *
 * The message is the code name in parentheses and nothing more. There is no human
 * sentence anywhere in the spec for any error, so passing the message through to a user
 * is passing through nothing — it looks like an explanation and is not one. That is why
 * every code is mapped here by hand.
 *
 * Rule 11 governs the last case. An error we do not recognise is **not** an error we can
 * name: it gets said plainly, with the raw code visible, rather than collapsed into the
 * nearest familiar sentence.
 */

/** Wallet API 0.10.3, `wallet-api/errors.d.ts`. All eleven. */
export const WALLET_ERRORS = {
  111: {
    name: "NOT_ERC20",
    say: "That contract is not an ERC-20 the wallet will handle.",
  },
  112: {
    name: "UNLISTED_NETWORK",
    say: "Your wallet does not have this network configured.",
  },
  113: {
    name: "USER_REFUSED_OP",
    say: "You declined the request in your wallet. Nothing was read and nothing was sent.",
  },
  114: {
    name: "INVALID_REQUEST_PAYLOAD",
    say: "The wallet rejected the shape of our request. That is our bug, not yours — "
      + "please report it.",
  },
  115: {
    name: "ACCOUNT_ALREADY_DEPLOYED",
    say: "That account is already deployed.",
  },
  116: {
    name: "DEPLOYMENT_DATA_NOT_AVAILABLE",
    say: "The wallet has no deployment data for this account yet.",
  },
  117: {
    name: "CHAIN_ID_NOT_SUPPORTED",
    say: "Your wallet does not support this network.",
  },
  118: {
    name: "NOT_REGISTERED",
    say: "This account has no shielded presence in the pool yet. Your first shield "
      + "creates one — and the wallet answering at all means it does speak STRK20.",
  },
  119: {
    name: "INSUFFICIENT_PRIVATE_BALANCE",
    say: "Your shielded balance does not cover this.",
  },
  120: {
    name: "PRIVACY_LEAK",
    say: "The wallet refused because the operation would have linked your shielded "
      + "activity to a public address.",
  },
  162: {
    name: "API_VERSION_NOT_SUPPORTED",
    say: "Your wallet does not support the Wallet API version this app speaks.",
  },
  163: {
    name: "UNKNOWN_ERROR",
    /* The spec's own catch-all. It tells us only that the wallet failed somewhere it
       could not attribute — so the honest reading is "the wallet broke", not any
       specific cause. Naming a cause here would be inventing one. */
    say: "Your wallet reported an internal failure it could not attribute. That is the "
      + "wallet's own catch-all, so the cause is on its side rather than in the request.",
  },
} as const satisfies Record<number, { name: string; say: string }>;

export interface WalletErrorReading {
  /** The numeric code, when one could be found. */
  code: number | null;
  /** The spec's name for it, or null when unrecognised. */
  name: string | null;
  /** What to show a user. Always non-empty, never a bare spec string. */
  say: string;
  /** True only when `code` matched the table. */
  recognised: boolean;
  /** Everything we could extract, for a report. Never shown as the only content. */
  raw: string;
}

/** Digs a numeric code out of whatever the wallet threw. */
function findCode(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  for (const key of ["code", "errorCode"]) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  /* Some wallets nest the RPC error one level down. */
  for (const key of ["error", "data", "cause"]) {
    const nested = o[key];
    if (nested && typeof nested === "object") {
      const c = findCode(nested);
      if (c !== null) return c;
    }
  }
  return null;
}

/** Everything printable about the thrown value, code included. */
function rawOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (typeof e !== "object" || e === null) return String(e);
  const o = e as Record<string, unknown>;
  const bits: string[] = [];
  if (o.code !== undefined) bits.push(`code ${String(o.code)}`);
  const msg = e instanceof Error ? e.message : o.message;
  if (typeof msg === "string" && msg) bits.push(msg);
  if (o.data !== undefined && typeof o.data !== "object") bits.push(`data ${String(o.data)}`);
  if (bits.length) return bits.join(" · ");
  /* Last resort, and the whole reason this function exists: `String(e)` on a plain
     object is "[object Object]", which loses everything. */
  try { return JSON.stringify(e); } catch { return Object.prototype.toString.call(e); }
}

/**
 * The name embedded in the spec's message, for wallets that send a message but no code.
 * Matching on the message is a fallback, never the primary route — the code is the
 * field the spec defines.
 */
function findNameInMessage(raw: string): number | null {
  const m = /An error occurred \(([A-Z_0-9]+)\)/.exec(raw)
    ?? /\b(NOT_REGISTERED|USER_REFUSED_OP|INVALID_REQUEST_PAYLOAD|UNKNOWN_ERROR|PRIVACY_LEAK|INSUFFICIENT_PRIVATE_BALANCE|API_VERSION_NOT_SUPPORTED|CHAIN_ID_NOT_SUPPORTED|UNLISTED_NETWORK|NOT_ERC20|ACCOUNT_ALREADY_DEPLOYED|DEPLOYMENT_DATA_NOT_AVAILABLE)\b/.exec(raw);
  if (!m) return null;
  const found = Object.entries(WALLET_ERRORS).find(([, v]) => v.name === m[1]);
  return found ? Number(found[0]) : null;
}

export function readWalletError(e: unknown): WalletErrorReading {
  const raw = rawOf(e);
  const code = findCode(e) ?? findNameInMessage(raw);
  const hit = code === null
    ? undefined
    : (WALLET_ERRORS as Record<number, { name: string; say: string }>)[code];

  if (hit) return { code, name: hit.name, say: hit.say, recognised: true, raw };

  /* Rule 11: an answer we cannot name is not an answer we may name. Say so, and show
     the code, because the code is what makes the report actionable for whoever reads it
     next. */
  return {
    code,
    name: null,
    recognised: false,
    say: code === null
      ? "Your wallet returned an error we do not recognise, and it carried no error code."
      : `Your wallet returned an error we do not recognise (code ${code}).`,
    raw,
  };
}
