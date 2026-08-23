/**
 * The pitch.
 *
 * The headline reveals a line at a time and the rest follows on a stagger, in the
 * same easing the instrument's rungs use, so the page moves in one language.
 *
 * Every line is real text in the HTML — the animation only moves what is already
 * there, and if the script never runs it is all simply visible.
 */
export function Hero() {
  return (
    <section className="hero">
      <h1>
        <span className="line" data-reveal style={{ ["--d" as string]: ".05s" }}>
          The bids stay <em>sealed</em>.
        </span>
        <span className="line" data-reveal style={{ ["--d" as string]: ".16s" }}>
          The price does not.
        </span>
      </h1>

      <div className="hero-body" data-reveal style={{ ["--d" as string]: ".30s" }}>
        <p>
          Highest bidder wins and pays the <strong>second-highest bid</strong>. The
          chain learns one number and nothing else — <strong>not even the winner&apos;s
          own bid</strong>.
        </p>
      </div>
    </section>
  );
}

/** How it works, in three beats, below the trust statement. */
export function HowItWorks() {
  const beats = [
    ["Bid", "Pick a level. Two hash anchors go on chain. No amount, no address."],
    ["Seal", "The contract stamps the block and freezes the set. Only then do seeds move."],
    ["Settle", "N+1 witnesses prove the second price. Not one bid is opened."],
  ] as const;

  return (
    <section id="how" aria-label="How it works" style={{ padding: 0 }}>
      <dl className="beats">
        {beats.map(([term, def], i) => (
          <div
            className="beat glow"
            key={term}
            data-reveal
            style={{ ["--d" as string]: `${i * 0.08}s` }}
          >
            <dt>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
