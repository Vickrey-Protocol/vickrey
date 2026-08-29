/**
 * The two hash chains, drawn.
 *
 * The thermometer commitment is the one idea a reader has to actually get, and prose
 * alone makes it look like magic. Two rows of links with the bid's rung marked shows
 * the whole mechanism: walking down from either end is easy, walking up is a preimage
 * break, and the two chains meet only at the level you committed to.
 *
 * Inline SVG rather than a library: it is eight circles and some lines, it must render
 * with no JavaScript, and it has to inherit the page's theme tokens.
 */
export function Thermometer({ levels = 8, bid = 4 }: { levels?: number; bid?: number }) {
  const W = 640, PAD = 34, GAP = (W - PAD * 2) / (levels - 1);
  const x = (i: number) => PAD + i * GAP;

  return (
    <figure className="thermo" role="img"
      aria-label={`A price ladder of ${levels} levels. The ascending chain is anchored at the bid's level and above; the descending chain at the bid's level and below. They overlap only at the level bid.`}>
      <svg viewBox={`0 0 ${W} 200`} width="100%" preserveAspectRatio="xMidYMid meet">
        {/* ── ascending: a witness here proves "my bid is at least t" ── */}
        <text x={PAD} y="26" className="thermo-lab">ascending chain — proves ℓ ≥ t</text>
        <line x1={x(0)} y1="52" x2={x(levels - 1)} y2="52" className="thermo-rail" />
        {Array.from({ length: levels }, (_, i) => (
          <circle key={`u${i}`} cx={x(i)} cy="52" r={i <= bid ? 7 : 5}
            className={i <= bid ? "thermo-on" : "thermo-off"} />
        ))}

        {/* ── the ladder itself ── */}
        {Array.from({ length: levels }, (_, i) => (
          <g key={`t${i}`}>
            <line x1={x(i)} y1="62" x2={x(i)} y2="138" className="thermo-tick" />
            <text x={x(i)} y="106" className={i === bid ? "thermo-num on" : "thermo-num"}>{i}</text>
          </g>
        ))}
        <rect x={x(bid) - 15} y="82" width="30" height="30" rx="7" className="thermo-bid" />

        {/* ── descending: a witness here proves "my bid is at most t" ── */}
        <line x1={x(0)} y1="148" x2={x(levels - 1)} y2="148" className="thermo-rail" />
        {Array.from({ length: levels }, (_, i) => (
          <circle key={`d${i}`} cx={x(i)} cy="148" r={i >= bid ? 7 : 5}
            className={i >= bid ? "thermo-on" : "thermo-off"} />
        ))}
        <text x={PAD} y="184" className="thermo-lab">descending chain — proves ℓ ≤ t</text>
      </svg>
      <figcaption className="note">
        A bid at level {bid}. The filled links are the ones the bidder can produce a
        witness for. Both chains are filled at level {bid} and nowhere else — which is
        what lets the contract pin a bid <em>exactly</em>, using two proofs that each
        reveal only a bound.
      </figcaption>
    </figure>
  );
}
