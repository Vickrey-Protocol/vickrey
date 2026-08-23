/**
 * The problem, stated plainly.
 *
 * The page explained the mechanism at length and never said what was wrong with the
 * alternative. A reader who does not already know why sealed bidding on a public chain
 * is hard has no way to tell whether any of the machinery is worth it.
 */
export function Problem() {
  return (
    <section id="problem" style={{ marginTop: "3rem" }}>
      <h2 className="section" data-reveal>The problem</h2>
      <div className="cols" style={{ marginTop: "1rem" }}>
        <div data-reveal>
          <p style={{ maxWidth: "62ch" }}>
            On a public chain a sealed bid has never really been sealed. Either you hand
            your amount to an auctioneer and trust them not to look, not to leak, and not
            to insert a bid of their own once they have seen yours — or you use
            commit–reveal, and every losing bid is published at the end.
          </p>
          <p style={{ maxWidth: "62ch", marginTop: ".9rem" }}>
            Publishing them destroys the thing a sealed auction is for. Your valuation is
            a business fact; it tells competitors what you will pay, and it is still true
            at the next auction.
          </p>
        </div>
        <div data-reveal style={{ ["--d" as string]: ".12s" }}>
          <p style={{ maxWidth: "62ch" }}>
            Commit–reveal has a second failure that is less discussed: it locks no money.
            A bidder who dislikes the result simply never reveals. In a second-price
            auction one silent bidder moves the price the winner pays, so the mechanism
            stops producing the outcome it promises.
          </p>
          <p style={{ maxWidth: "62ch", marginTop: ".9rem" }}>
            <b>Vickrey never opens a bid.</b> Collateral is escrowed up front, so silence
            costs money, and the winner and the price are proved from hash chains instead
            of disclosure. The losing bids are not withheld — they are never on the chain
            in the first place.
          </p>
        </div>
      </div>
    </section>
  );
}
