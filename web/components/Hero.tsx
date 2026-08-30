import Link from "next/link";
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

/**
 * The short explainer, and the destination of "How it works" in the navbar.
 *
 * It was three verbs and a link, with `padding: 0` and no scroll-margin — so jumping to
 * it put the sticky masthead over its top and filled the viewport with the "Live
 * auctions" heading directly beneath. The nav item looked like it pointed at the auction
 * list.
 *
 * Length was the other half of that. Three terms are a summary of an explanation, not an
 * explanation, and a reader arriving from the navbar has asked for the explanation. This
 * is deliberately still short — the reference is /docs and this must not compete with it
 * — but it now answers the two questions the beats assume you already know: what is
 * actually written on chain, and why the second price can be proved without opening a
 * bid.
 */
export function HowItWorks() {
  const beats = [
    ["Bid", "Pick a level on the ladder. Two hash anchors go on chain — no amount, no address."],
    ["Seal", "The contract freezes the set and stamps the block. Only then do seeds move."],
    ["Settle", "N+1 witnesses prove the second price. Not one bid is opened."],
  ] as const;

  return (
    <section id="how" aria-label="How it works" className="how">
      <h2 className="section" style={{ marginBlockStart: 0 }} data-reveal>How it works</h2>

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

      {/* The two things the three verbs above assume you already know. Without them the
          summary reads as a claim rather than a mechanism. */}
      <div className="how-more">
        <div data-reveal>
          <h3>What is on chain</h3>
          <p className="note">
            A bid is <b>two hashes and an escrow</b>. The escrow is the same for everyone —
            the top of the ladder — so the amount you send says nothing about the amount
            you bid. Your address never appears beside a price, and on the private rail it
            never appears at all.
          </p>
        </div>
        <div data-reveal style={{ ["--d" as string]: ".08s" }}>
          <h3>Why the price can be proved</h3>
          <p className="note">
            Each bid carries two hash chains. Walking one a known number of steps proves
            your level is <b>at or above</b> a rung; walking the other proves it is{" "}
            <b>at or below</b>. Together they pin the runner-up exactly and place everyone
            else, which is all a second-price auction needs — so the clearing price is
            proved while every bid stays sealed.
          </p>
        </div>
      </div>

      <p className="note how-doors" data-reveal>
        <Link href="/auctions">See a settled auction &rarr;</Link>
        <Link href="/docs">
          The full reference — the six properties, the hash-chain construction, and what
          the STRK20 integration does and does not reveal &rarr;
        </Link>
      </p>
    </section>
  );
}
