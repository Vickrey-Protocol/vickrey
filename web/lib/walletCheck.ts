/**
 * What each row of the STRK20 probe establishes, as two separate questions.
 *
 * This page has now been wrong three times, and the last two were the same mistake: one
 * error object was passed to one sentence-writer, and both rows printed it. But the rows
 * ask different questions, so the same error means different things in each.
 *
 *   real read      "can this wallet complete a pool balance read on this network?"
 *   reachability   "does the method exist and respond at all?"
 *
 * `readWalletError().say` answers the first. Reusing it in the second produced two
 * visible bugs. On Xverse the reachability row explained that the account has no shielded
 * presence in the pool — an answer about balances, in a row about whether a method
 * responds, and contradicted by the real read passing directly above it. On Ready X the
 * same row said "That is our bug, not yours", because the argumentless call is an invalid
 * payload and that is what the mapped sentence says. It is not a bug: we send that call
 * deliberately, and a wallet rejecting it is behaving correctly.
 *
 * So the reachability row never uses `say`. It reports the one fact it can support — the
 * method responded — and names the code for the record without interpreting it.
 */
import { readWalletError } from "@vickrey/client";

export type RowState = "pass" | "fail" | "warn" | "pending";
export interface Row { label: string; state: RowState; detail: string }

export const REAL_READ_LABEL = "real read · strk20Balances([STRK])";
export const REACH_LABEL = "reachability · no token list";

/**
 * The pool and the user answering are not the wallet failing.
 *
 * NOT_REGISTERED (118) is the pool replying through a wallet that routed the call, and
 * USER_REFUSED_OP (113) is you. Both prove the interface is there. Every other code —
 * the spec's own catch-all included — is a read that did not work, and must not be
 * dressed up as a pass.
 */
export const routedNotFailed = (code: number | null) => code === 118 || code === 113;

export function realReadPassed(entryCount: number, onNet: string): Row {
  return {
    label: REAL_READ_LABEL,
    state: "pass",
    detail: `PASS on ${onNet} — the wallet completed a pool read and returned `
      + `${entryCount} balance entr${entryCount === 1 ? "y" : "ies"}. No figure is shown `
      + "here or sent anywhere; this page reports only that the read worked.",
  };
}

export function realReadFailed(e: unknown, onNet: string): Row {
  const err = readWalletError(e);
  const routed = routedNotFailed(err.code);
  return {
    label: REAL_READ_LABEL,
    state: routed ? "pass" : "fail",
    detail: routed
      ? `PASS on ${onNet} — ${err.say} The wallet routed a real read, so the interface is there.`
      : `FAIL on ${onNet} — ${err.say}` + (err.recognised ? "" : ` Raw: ${err.raw}`),
  };
}

/**
 * The wallet accepted a request with no `tokens` field.
 *
 * Not a pass for STRK20 and not a failure either — `tokens` is required, so answering an
 * incomplete request is lenient rather than correct. It is recorded because this is the
 * call the old probe made, and the fact it could succeed is why the page was wrong.
 */
export function reachabilityAnswered(): Row {
  return {
    label: REACH_LABEL,
    state: "pass",
    detail: "The method responded to a request with no token list. That establishes the "
      + "method exists and nothing more — it is not a balance read, and it is the check "
      + "that used to stand in for one here. The row above is the one that counts.",
  };
}

export function reachabilityRejected(e: unknown): Row {
  const err = readWalletError(e);
  /* The code, named, without its sentence. The sentence answers the other row's
     question, and borrowing it is what produced two wrong messages. */
  const named = err.name ? ` It answered ${err.name}.` : err.code !== null
    ? ` It answered code ${err.code}.` : "";
  return {
    label: REACH_LABEL,
    /* Never a warning. `tokens` is required and we omitted it on purpose; refusing an
       incomplete request is the wallet being right. */
    state: "pass",
    detail: "The method responded, rejecting a request with no token list — which is "
      + `correct, since \`tokens\` is required and this call omits it deliberately.${named}`
      + " This establishes the method exists and nothing more; the row above is the one "
      + "that counts.",
  };
}
