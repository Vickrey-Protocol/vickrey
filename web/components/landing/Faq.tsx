/**
 * The questions a visitor actually has, in the template's shape: a centred heading,
 * one column of rows divided by hairlines, an arrow that turns when a row opens.
 *
 * Every answer has to agree with the trust statement — including the ones that are
 * unflattering. Overclaiming here costs more than it buys.
 *
 * The template rendered each answer only while open, on a motion library, so five of
 * six answers were not in the document until a click. Every answer here is in the
 * HTML: each row is a native <details>, one `name` makes the group exclusive, and the
 * opening height is a CSS transition where the browser has it and instant where it
 * does not — which is the right thing to lose.
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
        Nothing while bidding is open: no amount has been posted anywhere. Once the
        contract freezes the bid set, each bid is posted on chain encrypted to a key the
        auctioneer made for this auction, and from that moment the auctioneer knows every
        amount. It can never publish them, prove a false outcome, or spend anyone&rsquo;s
        funds. But it knows them, and that is the honest limit of what this design gives
        you. The encrypted bids stay on chain, so anyone who ever obtains that key can
        read them; the auctioneer is prompted to delete it once the auction is final.
      </>
    ),
  },
  {
    q: "What happens if a bid isn't revealed?",
    a: (
      <>
        After the seal, Vickrey&rsquo;s relay posts each bid&rsquo;s encrypted reveal, and
        you can post it yourself if the relay doesn&rsquo;t. A bid whose reveal is not posted
        in the reveal window is settled around, not waited for: it is marked forfeit and
        left out of the ranking. If it was at or
        below the clearing price, its owner can reclaim the escrow after the auction
        finalizes; above it, the escrow cannot be redeemed.
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
    q: "What can be auctioned?",
    a: (
      <>
        An amount of a token, one NFT, or something off chain. Tokens and NFTs are held by
        the contract from listing. An NFT goes to a public address the winner names,
        because the privacy pool can&rsquo;t hold NFTs. An off-chain lot is held by nobody:
        you are trusting the seller to deliver, and if you reject delivery, your payment
        does not come back — it is destroyed, along with the seller&rsquo;s bond.
      </>
    ),
  },
  {
    q: "Is this audited? Is it on mainnet?",
    a: (
      <>
        <strong>Nothing has been audited.</strong> The contracts run on Starknet mainnet,
        and the earlier version stays readable on the site. The README carries the honest
        status of every piece.
      </>
    ),
  },
];

export function LpFaq() {
  return (
    <section id="faq" data-anchor className="lp-faq tw:mx-auto tw:w-full tw:max-w-7xl tw:p-0 tw:py-10 tw:md:py-20" aria-labelledby="faq-h">
      <h2
        id="faq-h" data-reveal data-beat="faq"
        className="tw:mx-auto tw:max-w-4xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-6xl"
      >
        Before you bid
      </h2>
      <p data-reveal className="tw:mx-auto tw:mt-4 tw:max-w-lg tw:text-center tw:text-sm tw:text-neutral-500 tw:dark:text-neutral-400 tw:text-balance">
        Every answer here agrees with the trust statement — including the ones that are
        unflattering.
      </p>
      <div className="tw:mx-auto tw:mt-10 tw:max-w-3xl tw:divide-y tw:divide-neutral-200 tw:dark:divide-neutral-800 tw:md:mt-20" data-reveal>
        {QA.map(({ q, a }, i) => (
          <details key={q} name="faq" open={i === 0} className="tw:group tw:py-4 tw:md:py-6">
            <summary className="tw:flex tw:cursor-pointer tw:list-none tw:items-start tw:justify-between tw:gap-6 tw:[&::-webkit-details-marker]:hidden">
              <h3 className="tw:m-0 tw:text-base tw:font-medium tw:tracking-normal tw:text-neutral-800 tw:dark:text-neutral-200 tw:md:text-lg">{q}</h3>
              <span aria-hidden="true" className="tw:relative tw:mt-1 tw:mr-2 tw:h-5 tw:w-5 tw:flex-none tw:transition-transform tw:duration-200 tw:group-open:rotate-90 tw:md:mr-4 tw:md:h-6 tw:md:w-6">
                <svg className="tw:absolute tw:inset-0 tw:h-full tw:w-full tw:text-neutral-500 tw:dark:text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </summary>
            <p className="tw:m-0 tw:mt-2 tw:pr-8 tw:text-sm tw:text-neutral-500 tw:dark:text-neutral-400 tw:md:pr-12 tw:md:text-base">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
