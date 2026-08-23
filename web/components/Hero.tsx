/**
 * The pitch.
 *
 * A visitor who has never heard of a second-price auction has to be able to tell what
 * this is before the trust statement means anything. Without it the trust statement
 * reads as a legal notice bolted to an empty page.
 */
export function Hero() {
  return (
    <section className="hero">
      <h1>
        The bids stay <em>sealed</em>. The price does not.
      </h1>

      <div className="hero-body">
        <p>
          A Vickrey auction is the theoretically optimal auction: the highest bidder
          wins and pays the <strong>second-highest bid</strong>, which makes bidding
          your true valuation the dominant strategy. There is nothing to game.
        </p>
        <p>
          It has been known since 1961 and has never been deployable on a public chain.
          Sealing the bids meant trusting an auctioneer with all of them; revealing them
          at the end destroyed the privacy the mechanism depends on. Commit-reveal gets
          you neither: it locks no money, and one bidder going quiet distorts the result.
        </p>
        <p>
          This one settles with a <strong>proof</strong>. The winner and the clearing
          price are established on-chain by hash-preimage witnesses over a bid set the
          contract froze before anyone could open it. The losing bids are never
          published — not on chain, not in this app, nowhere but the bidders&apos; own
          devices. <strong>Neither is the winner&apos;s.</strong>
        </p>
      </div>
    </section>
  );
}

/**
 * How it works, in three beats. Sits below the trust statement so those two sentences
 * stay near the top of the page.
 */
export function HowItWorks() {
  return (
    <section aria-label="How it works">
      <dl className="beats">
        <div className="beat">
          <dt>Bid</dt>
          <dd>
            You pick a level on a public price ladder. Two hash anchors go on chain and
            nothing else — no amount, and no address, because a bid is keyed by a claim
            handle rather than by you.
          </dd>
        </div>
        <div className="beat">
          <dt>Seal</dt>
          <dd>
            At the deadline the contract stamps the block and freezes the set. Only then
            do bidders send the auctioneer anything, so it cannot have read the book
            early — it had not been sent one.
          </dd>
        </div>
        <div className="beat">
          <dt>Settle</dt>
          <dd>
            The winner proves they are at or above the clearing level, the runner-up
            exactly on it, everyone else at or below. The second price becomes a proved
            fact, and not one bid was opened to establish it.
          </dd>
        </div>
      </dl>
    </section>
  );
}
