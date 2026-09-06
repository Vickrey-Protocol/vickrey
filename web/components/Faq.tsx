/**
 * The questions a visitor actually has.
 *
 * Every answer has to agree with the trust statement — including the ones that are
 * unflattering. Overclaiming here costs more than it buys.
 *
 * Six answers open at once was a wall of prose in a two-column grid: nobody reads it,
 * and the questions themselves — which are the scannable part — were buried inside it.
 * One column of rows that open on click puts the six questions on screen at once and
 * gives the reader the one they came for.
 *
 * Native <details> rather than an accordion component. Every answer is in the document
 * whether or not any script ran, so the content is never conditional on hydration;
 * open, close, keyboard and screen-reader semantics come from the browser; and
 * `name` makes the group exclusive without a line of state. The height animation is
 * ::details-content, which only some browsers have — where they do not, the rows open
 * instantly, which is the correct thing to lose.
 */
const QA: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is a Vickrey auction?",
    a: (
      <>
        The highest bidder wins and pays the <strong>second-highest bid</strong>. That
        makes bidding your true valuation the dominant strategy — shading your bid
        gains you nothing. It has been the theoretically optimal design since 1961.
      </>
    ),
  },
  {
    q: "How can the bids be sealed and the price still be proved?",
    a: (
      <>
        A bid publishes two hash chains rather than an amount. Revealing a link of one
        proves &ldquo;at or above this level&rdquo;; the other proves &ldquo;at or
        below&rdquo;. The winner, the runner-up and everyone else each prove one bound,
        and together those pin the second price without opening a single bid.
      </>
    ),
  },
  {
    q: "What does the auctioneer learn, and when?",
    a: (
      <>
        Nothing while bidding is open — it has not been sent anything. Once the contract
        freezes the bid set, bidders send their seeds, and from that moment the
        auctioneer knows every amount. It can never publish them, prove a false outcome,
        or spend anyone&rsquo;s funds. But it knows them, and that is the honest limit of
        what this design gives you.
      </>
    ),
  },
  {
    q: "What happens if a bidder goes silent?",
    a: (
      <>
        Settlement still completes. A bid nobody can prove is marked forfeit and left out
        of the ranking, and its escrow stays claimable by its owner whenever they come
        back. If leaving it out changed the outcome, that bidder can prove so during the
        dispute window and void the settlement.
      </>
    ),
  },
  {
    q: "What does it cost to bid?",
    a: (
      <>
        Through the privacy pool: a flat pool fee per operation — 6 STRK on mainnet, read
        live from the pool rather than set by us — plus the escrow, which comes back. A
        bid placed directly on the contract costs gas alone; the amount stays sealed, but
        your address is public.
      </>
    ),
  },
  {
    q: "Is this audited? Is it on mainnet?",
    a: (
      <>
        No, and not yet. The contracts are deployed to Sepolia and a complete auction has
        run there end to end. <strong>Nothing has been audited.</strong> Mainnet is the
        target before the sprint closes, and the README carries the honest status of
        every piece.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq">
      <p className="eyebrow">Questions</p>
      <h2 className="section" style={{ marginTop: 0 }} data-reveal>Before you bid</h2>
      <div className="faq">
        {QA.map(({ q, a }, i) => (
          <details
            className="faq-item glow"
            /* One group, so opening an answer closes the last one. */
            name="faq"
            /* The first is open so the section reads as answers, not as six shut doors. */
            open={i === 0}
            key={q}
            data-reveal
            style={{ ["--d" as string]: `${i * 0.04}s` }}
          >
            <summary className="faq-q">
              {q}
              {/* A plus that loses its upright stroke when the row opens. Decoration:
                  the state is already announced by the summary itself. */}
              <span className="faq-mark" aria-hidden="true" />
            </summary>
            <p className="faq-a">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
