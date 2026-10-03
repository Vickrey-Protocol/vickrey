/**
 * The terms of an off-chain lot: the seller fills a template, the text is published on
 * chain word for word, and the contract stores its hash (`lib/v2.ts` `termsHash`).
 *
 * The text is plain labelled lines, so it reads the same in an explorer as it does here,
 * and anything that does not parse is shown raw rather than dropped.
 */
export interface TermsFields {
  what: string;
  condition: string;
  how: string;
  within: string;
  counts: string;
  reach: string;
}

const LABELS: Array<[keyof TermsFields, string]> = [
  ["what", "What it is"],
  ["condition", "Condition"],
  ["how", "How it's delivered"],
  ["within", "Delivered within"],
  ["counts", "What counts as delivered"],
  ["reach", "How to reach the seller"],
];

/** Fields the seller must fill. Condition is optional. */
export const REQUIRED: Array<keyof TermsFields> = ["what", "how", "within", "counts", "reach"];

export const missingFields = (f: TermsFields): Array<keyof TermsFields> =>
  REQUIRED.filter((k) => !f[k].trim());

export const labelOf = (k: keyof TermsFields) => LABELS.find(([key]) => key === k)![1];

export function termsText(f: TermsFields): string {
  return LABELS
    .filter(([k]) => f[k].trim())
    .map(([k, label]) => `${label}: ${f[k].trim().replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
}

/** Back to labelled rows for display. Lines that match no label come back as `other`. */
export function parseTerms(text: string): Array<{ label: string; value: string }> {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const hit = LABELS.find(([, label]) => line.startsWith(`${label}: `));
    return hit
      ? { label: hit[1], value: line.slice(hit[1].length + 2) }
      : { label: "", value: line };
  });
}
