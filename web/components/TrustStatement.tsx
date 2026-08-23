import { TRUST_ASSURED, TRUST_NOT } from "@/lib/ui";

/**
 * R2: in full, on the landing page and on every auction detail page. One component so
 * that "in full" cannot quietly become "in full on one of them".
 */
export function TrustStatement({ delay }: { delay?: string }) {
  return (
    <div className="trust" data-reveal style={delay ? { ["--d" as string]: delay } : undefined}>
      <p className="trust-label">What this guarantees</p>
      <p className="trust-body">
        <b>What is assured:</b> {TRUST_ASSURED} <b>What is not:</b> {TRUST_NOT}
      </p>
    </div>
  );
}
