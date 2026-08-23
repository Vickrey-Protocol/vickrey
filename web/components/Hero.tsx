/**
 * The pitch, at half the length it was.
 *
 * A visitor who has never heard of a second-price auction has to be able to tell
 * what this is before the trust statement means anything.
 */
export function Hero() {
  return (
    <section className="hero">
      <h1>
        The bids stay <em>sealed</em>. The price does not.
      </h1>
      <div className="hero-body">
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
  return (
    <section id="how" aria-label="How it works" style={{ padding: 0 }}>
      <dl className="beats">
        <div className="beat">
          <dt>Bid</dt>
          <dd>Pick a level. Two hash anchors go on chain. No amount, no address.</dd>
        </div>
        <div className="beat">
          <dt>Seal</dt>
          <dd>The contract stamps the block and freezes the set. Only then do seeds move.</dd>
        </div>
        <div className="beat">
          <dt>Settle</dt>
          <dd>N+1 witnesses prove the second price. Not one bid is opened.</dd>
        </div>
      </dl>
    </section>
  );
}
