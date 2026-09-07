/**
 * The problem, stated plainly, in the template's centred-heading-over-columns shape.
 *
 * The page explains the mechanism at length; a reader who does not already know why
 * sealed bidding on a public chain is hard has no way to tell whether any of the
 * machinery is worth it. Every sentence here is the copy that stood before the
 * redesign — the claims are the product's, not the template's.
 */
/* Paragraphs keep their UA margins outside Tailwind's preflight; the column's gap is the rhythm here. */
const COL = "tw:flex tw:flex-col tw:gap-4 tw:*:m-0 tw:text-base tw:leading-relaxed tw:text-neutral-600 tw:md:text-lg";

export function LpProblem() {
  return (
    <section id="problem" className="tw:p-0 tw:pt-24 tw:md:pt-32" aria-labelledby="problem-h">
      <h2
        id="problem-h" data-reveal data-beat="problem"
        className="tw:mx-auto tw:max-w-5xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-5xl tw:md:leading-tight"
      >
        The problem
      </h2>
      <div className="tw:mx-auto tw:mt-10 tw:grid tw:max-w-5xl tw:gap-x-12 tw:gap-y-6 tw:md:mt-14 tw:md:grid-cols-2">
        <div className={COL} data-reveal>
          <p>
            On a public chain a sealed bid has never really been sealed. Either you hand
            your amount to an auctioneer and trust them not to look, not to leak, and not
            to insert a bid of their own once they have seen yours — or you use
            commit–reveal, and every losing bid is published at the end.
          </p>
          <p>
            Publishing them destroys the thing a sealed auction is for. Your valuation is
            a business fact; it tells competitors what you will pay, and it is still true
            at the next auction.
          </p>
        </div>
        <div className={COL} data-reveal style={{ ["--d" as string]: ".12s" }}>
          <p>
            Commit–reveal has a second failure that is less discussed: it locks no money.
            A bidder who dislikes the result simply never reveals. In a second-price
            auction one silent bidder moves the price the winner pays, so the mechanism
            stops producing the outcome it promises.
          </p>
          <p>
            <b className="tw:font-semibold tw:text-black">Vickrey never opens a bid.</b> Collateral is escrowed up front, so silence
            costs money, and the winner and the price are proved from hash chains instead
            of disclosure. The losing bids are not withheld — they are never on the chain
            in the first place.
          </p>
        </div>
      </div>
    </section>
  );
}
