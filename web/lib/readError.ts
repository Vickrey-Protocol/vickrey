/**
 * A failed chain read, as a person reads it. The public RPC answers a burst of reads with
 * a plain-text "Rate limit exceeded", which surfaces as a JSON parse error; nobody should
 * see that. Anything unrecognised is shown as it is.
 */
export function plainReadError(msg: string | null | undefined): string {
  if (!msg) return "";
  if (/rate limit/i.test(msg)) return "The network is busy right now. Try again in a moment.";
  if (/failed to fetch|fetch failed|networkerror|network error|load failed/i.test(msg)) {
    return "The network didn't answer. Check your connection and try again.";
  }
  return msg;
}
