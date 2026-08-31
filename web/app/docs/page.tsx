import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { Thermometer } from "@/components/docs/Thermometer";
import { TrustStatement } from "@/components/TrustStatement";

export const metadata = {
  title: "How it works",
  alternates: { canonical: "/docs" },
  openGraph: { url: "/docs", title: "How Vickrey works" },
  description:
    "What a Vickrey auction is, why sealing bids on a public chain is hard, and the hash-chain construction that settles one without ever publishing a bid.",
};

const REPO = "https://github.com/Vickrey-Protocol/vickrey";
const SECTIONS = [
  ["what", "What this is"],
  ["properties", "Six properties"],
  ["thermometer", "The thermometer commitment"],
  ["escrow", "Escrow, silence, and exclusion"],
  ["strk20", "How it uses STRK20"],
  ["reveal", "The reveal channel"],
  ["lifecycle", "Lifecycle and time gates"],
  ["unshipped", "What didn't ship"],
  ["source", "Source, tests, runbook"],
] as const;

const PROPERTIES = [
  {
    n: 1, title: "Bids are real escrowed funds, not promises",
    hard: "Commit-reveal locks nothing. A bidder can commit to a price they cannot pay, and you only find out at the end.",
    how: "Placing a bid transfers collateral into the contract in the same transaction that records it. A bid that is not funded does not exist.",
  },
  {
    n: 2, title: "The chain never learns a bid. The auctioneer learns them only after the set is frozen",
    hard: "Designs with a trusted auctioneer leak every bid to whoever runs the server, from the moment it arrives.",
    how: "During bidding the chain holds two hashes per bid and nothing else, and nobody — auctioneer included — has been sent an amount. After `seal()` freezes the set, bidders send their seeds and the auctioneer does learn every exact bid. That ordering is the whole protection: by then the set cannot change, no bid can be added or dropped, and the clearing price is already determined by bids nobody could edit. What the auctioneer never gets is the ability to act on the knowledge — or to publish it, since the amounts never touch the chain.",
  },
  {
    n: 3, title: "The bid set is frozen before any amount can be read",
    hard: "If the party producing the result picks the set after seeing the contents, they can drop a rival's high bid and claim it never arrived.",
    how: "`seal()` stamps the block number and freezes the set on-chain. Only afterwards do bidders send their seeds. Excluding a bid that arrived is provable, and slashes the auctioneer's bond. Sealing is permissionless — the contract checks only that the bid deadline has passed — so an auctioneer cannot stall an auction by refusing to seal it, and any bidder can start the clock themselves.",
    star: true,
  },
  {
    n: 4, title: "Losing bids are never published",
    hard: "Every commit-reveal auction ends by publishing all of them. Your valuation is a business fact, and it is still true at the next auction.",
    how: "Settlement proves the outcome from bounds. The clearing price is revealed because it is the price; every other bid stays a pair of hashes forever.",
    star: true,
  },
  {
    n: 5, title: "The outcome is proved, not asserted",
    hard: "Most implementations ask you to trust that the settlement transaction did the arithmetic honestly.",
    how: "The contract verifies N+1 hash-preimage witnesses: the winner at or above the clearing level, the runner-up exactly at it, everyone else at or below. A false outcome cannot produce them.",
  },
  {
    n: 6, title: "Refusing to reveal cannot grief the auction",
    hard: "In commit-reveal, a bidder who dislikes the result simply never reveals — and in a second-price auction one silent bidder moves the price the winner pays.",
    how: "Settlement needs no cooperation from a bidder who stays silent: their bid is marked forfeited and the auction completes without them. Silence costs that bidder a delay rather than their escrow — they redeem it themselves afterwards with a late loser-side proof.",
  },
];

export default function Page() {
  return (
    <PublicShell>
      <header className="docs-head">
        <p className="eyebrow">Documentation</p>
        <h1 className="display" style={{ fontSize: "var(--step-4)", margin: ".3rem 0 0" }}>
          How it works
        </h1>
        <p style={{ marginTop: "1rem", fontSize: "var(--s-1)", color: "var(--ink-2)" }}>
          A Vickrey auction has been the theoretically right way to sell one thing since
          1961, and has never worked on a public chain. This is what it takes to make one
          work, written so you can check the claims rather than take them.
        </p>
      </header>

      <div className="docs">
        {/* Plain anchors, and a native <details> so the narrow layout collapses without
            JavaScript. `open` means it is expanded by default on wide screens, where the
            summary is hidden and it behaves as an ordinary sticky rail. */}
        <details className="docs-nav" open>
          <summary>Contents</summary>
          <nav className="docs-toc" aria-label="Contents">
            <p className="dash-group">Contents</p>
            {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
            <hr />
            <a href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
            <Link href="/auctions">Live auctions</Link>
          </nav>
        </details>

        <article className="docs-body">
          {/* ── 1 ─────────────────────────────────────────────────────────── */}
          <section id="what">
            <h2 className="section" style={{ marginTop: 0 }}>What this is</h2>
            <p>
              In a <b>sealed-bid auction</b> everyone submits one bid without seeing the
              others. In a <b>Vickrey</b> auction — second-price — the highest bidder wins
              but pays the <em>second</em>-highest bid.
            </p>
            <p>
              That second part sounds like a giveaway and is the opposite. If you pay your
              own bid, you shade it down to leave room for profit, and you are guessing
              about other people rather than about the thing being sold. If you pay the
              runner-up&rsquo;s bid, bidding your honest valuation is your best move no
              matter what anyone else does. The auction stops being a game about opponents
              and starts being a question about value.
            </p>
            <p>
              Getting there needs the bids sealed. On a public chain they never really
              were. Either you hand your amount to an auctioneer and trust them not to
              look, not to leak, and not to insert a bid of their own once they have seen
              yours — or you use commit–reveal, where every bid is published at the end.
            </p>
            <p>
              Publishing them destroys the thing the auction was for. And commit–reveal
              has a second problem that is less discussed: it locks no money, so a bidder
              who dislikes the outcome simply never reveals. In a second-price auction one
              silent bidder changes what the winner pays.
            </p>
            <p className="lede">
              <b>Vickrey never opens a bid.</b> Collateral is escrowed up front, so silence
              costs money, and the winner and the price are proved with hash chains instead
              of disclosure. The losing bids are not withheld — they are never on the chain
              at all.
            </p>

            <h3>The difference from commit–reveal, concretely</h3>
            <p>
              Almost every sealed-bid auction on a public chain is commit–reveal: you post
              a hash of your bid, and after bidding closes you post the bid itself so the
              contract can check it against the hash. It is a sound and well-understood
              construction, and it is not what this is.
            </p>
            <p>
              The distinction is what the chain holds when the auction is over.
            </p>
            <div className="cols" style={{ marginBlock: "1rem" }}>
              <div className="panel">
                <p className="eyebrow">Commit–reveal, at the end</p>
                <ul className="tight">
                  <li>Every bid is public, winners and losers alike</li>
                  <li>Your valuation is readable by anyone, permanently, and it is still
                    true at the next auction</li>
                  <li>A bidder who dislikes the outcome can withhold their reveal, and in
                    a second-price auction that moves what the winner pays</li>
                </ul>
              </div>
              <div className="panel">
                <p className="eyebrow">Here, at the end</p>
                <ul className="tight">
                  <li>One number is published: the clearing price, because it is the price</li>
                  <li>Every other bid is still two hashes — including the winner&rsquo;s
                    own</li>
                  <li>Silence marks a bid forfeited and settlement proceeds regardless
                    &mdash; that escrow is redeemable later, not lost</li>
                </ul>
              </div>
            </div>
            <p>
              There is a corollary worth being explicit about. In commit–reveal the
              question &ldquo;can the auctioneer exclude a rival&rsquo;s bid?&rdquo;
              largely dissolves, because by settlement every bid is public and anyone can
              compute the result. That is a real answer — but it is bought by publishing
              the bids, which is the thing being avoided here. Keeping them sealed means
              the exclusion problem has to be solved rather than dissolved, which is what
              sealing before reveal and the auctioneer&rsquo;s slashable bond are for.
            </p>
          </section>

          {/* ── 2 ─────────────────────────────────────────────────────────── */}
          <section id="properties">
            <h2 className="section">Six properties, and why each is hard</h2>
            <p>
              Each of these is a place a straightforward implementation breaks. They are
              listed because they are checkable, not because they are features.
            </p>
            <ol className="props">
              {PROPERTIES.map((p) => (
                <li key={p.n} className={p.star ? "prop prop-star" : "prop"}>
                  <p className="prop-title">
                    <span className="prop-n">{p.n}</span> {p.title}
                  </p>
                  <p className="note"><b>What normally goes wrong:</b> {p.hard}</p>
                  <p><b>Here:</b> {p.how}</p>
                </li>
              ))}
            </ol>
            <p className="note">
              Properties 3 and 4 are marked because they are the two that are genuinely
              hard to get elsewhere. 3 is an attack most designs never consider — the
              auctioneer choosing the set after seeing the contents. 4 is the one a
              bidder feels: the auction ends and their number was never anywhere but their
              own browser.
            </p>
          </section>

          {/* ── 3 ─────────────────────────────────────────────────────────── */}
          <section id="thermometer">
            <h2 className="section">The thermometer commitment</h2>
            <p>
              This is the one piece of cryptography you have to follow, and it is a hash
              function used twice.
            </p>
            <p>
              Bids are not free-form amounts. They are <b>levels on a public ladder</b>:
              level 0 is the reserve, and each step up adds a fixed tick. Bidding at all
              means bidding at least the reserve, so the reserve needs no separate rule.
            </p>
            <p>
              A hash chain is a value hashed repeatedly. Given a link, anyone can walk{" "}
              <em>forward</em> by hashing again; walking <em>backward</em> would mean
              inverting the hash, which is the thing hash functions are for. So handing
              someone a link from a known depth proves you knew a value that far along —
              and proves nothing else.
            </p>
            <p>
              Each bidder publishes <b>two</b> anchors, one from each end of the ladder:
            </p>
            <pre className="code" aria-label="the two anchors">{`step(x) = poseidon([CHAIN_TAG, auction_id, claim_commitment, x])

up_anchor   = step^(ℓ)        a depth-t preimage proves   ℓ ≥ t
down_anchor = step^(P−1−ℓ)    a depth-(P−1−t) preimage proves  ℓ ≤ t`}</pre>
            <Thermometer levels={8} bid={4} />
            <p>
              Each witness reveals <em>one bound</em>, never the level. &ldquo;At least
              4&rdquo; is compatible with 4, 5, 6 or 7. But the two together pin a level
              exactly, and that is what settlement needs: the winner proves{" "}
              <b>at or above</b> the clearing level, the runner-up proves{" "}
              <b>exactly at</b> it, and everyone else proves <b>at or below</b>.
            </p>
            <p>
              Which gives the whole result. The second-highest bid is established as the
              price, by the person who made it, without that bid ever being stated — and
              every other bidder has said only &ldquo;mine was not higher than
              that&rdquo;. Producing a witness for a bound you did not commit to is a
              Poseidon preimage break.
            </p>

            <h3>Why it is N+1 witnesses, and why that is enough</h3>
            <p>
              For N bids the auctioneer submits <b>N+1</b> witnesses: one per bid, plus a
              second for the runner-up. The runner-up needs two because they are the only
              party whose level must be pinned <em>exactly</em> — one witness proves they
              are at least at the clearing level, the other that they are at most at it,
              and together those say <em>equals</em>.
            </p>
            <p>
              That set is sufficient to establish a Vickrey outcome, and the contract
              checks it rather than trusting it. If the claimed price were too low, the
              runner-up&rsquo;s &ldquo;exactly&rdquo; proof would not verify. If it were
              too high, the winner&rsquo;s &ldquo;at or above&rdquo; proof would not. And
              if a losing bid were really above the price, its &ldquo;at or below&rdquo;
              proof could not be produced at all.
            </p>
            <p>
              Each witness is a hash chain walk, so the whole settlement is linear in the
              number of bids — no sorting network, no pairwise comparisons, and nothing
              that grows quadratically as the auction fills up.
            </p>
            <p className="note">
              Settlement is O(N): N+1 witnesses for N bids, each a few hashes. Measured
              cost for three bids is in the README.
            </p>
          </section>

          {/* ── 3b ────────────────────────────────────────────────────────── */}
          <section id="escrow">
            <h2 className="section">Escrow, silence, and exclusion</h2>
            <p>
              Three mechanisms that are not cryptography. Each closes an attack the hash
              chains do not touch.
            </p>

            <h3>Everyone escrows the same amount, and it is the top of the ladder</h3>
            <p>
              A bidder posts collateral equal to the <b>cap</b> — the highest level on the
              ladder — regardless of what they actually bid. Bidding level 2 out of 8 and
              bidding level 7 lock identical amounts.
            </p>
            <p className="lede">
              This is not caution, it is the whole point. Escrow moves as an ordinary
              ERC-20 transfer, and a transfer is public. If the amount tracked the bid,
              <b> the transfer would publish the bid</b> — and everything else here would
              be theatre.
            </p>
            <p>
              A uniform amount says nothing beyond &ldquo;someone bid&rdquo;, which the
              chain already shows. The cost is capital efficiency: a low bidder locks more
              than they intend to spend. The difference comes back at settlement — and on
              the private rail it comes back as a note inside the pool, so even the refund
              does not reveal how much was unspent.
            </p>

            <h3>Staying silent cannot grief the auction</h3>
            <p>
              In commit–reveal, a bidder who dislikes the result simply never reveals. In a
              second-price auction that is not a small problem: the runner-up going quiet
              changes what the winner pays. So non-reveal is an attack, and it is free.
            </p>
            <p>
              Here it costs the collateral. A bidder who never sends their seed is marked
              <b> forfeited</b> — the auctioneer proves it with the loser-side witness — and
              settlement proceeds without them. The auction does not wait, does not stall,
              and does not need their cooperation. Their escrow is not returned.
            </p>
            <p className="note">
              A bidder who forfeited but was genuinely above the clearing price can still
              redeem later by presenting the proof they withheld — so the penalty falls on
              obstruction, not on a lost connection.
            </p>

            <h3>Forfeited escrow stays in the contract, deliberately</h3>
            <p>
              Read the contract and you will find money that can never come out. A bid
              whose anchors match no rung — which <code>place_bid</code> cannot detect,
              because it is handed two hashes and never a level — is marked forfeited at
              settlement, and its escrow then sits there permanently. No claim path
              releases it: <code>claim_refund</code> refuses a forfeited bid,{" "}
              <code>redeem_forfeit</code> needs a witness that cannot exist for a bogus
              anchor, and <code>finalize</code> never sweeps it.
            </p>
            <p>
              That looks like a bug. It is what keeps a different one closed.
            </p>
            <p className="lede">
              Marking a bid forfeited requires <b>no proof at all</b> — the auctioneer
              simply declares it, and the dispute window is what checks them. So if
              forfeited escrow were paid out to the seller, an auctioneer who is also the
              seller would <b>profit from forfeiting everybody</b>. The obvious fix funds
              the attack.
            </p>
            <p>
              Stranding it removes the incentive completely: a forfeit pays nobody, so
              there is nothing to gain by declaring one. The bidder who is actually harmed
              — someone honest who went offline — is not the one stranded, because they
              can produce the loser-side proof late and{" "}
              <code>redeem_forfeit</code> returns their escrow in full. What is stranded
              is only the escrow of a bid that was malformed on purpose, by the person who
              malformed it.
            </p>
            <p className="note">
              Four end-to-end tests cover this, and a conservation test asserts the
              contract holds nothing at all once an ordinary auction has been claimed out.
            </p>

            <h3>The auctioneer cannot drop a rival&rsquo;s bid</h3>
            <p>
              The auctioneer learns every level after sealing. The obvious attack is to
              pretend a high bid never arrived, settle lower, and win the lot cheaply — or
              hand it to a friend.
            </p>
            <p>
              Two things stop it. <b>Ordering:</b> <code>seal()</code> freezes the set and
              stamps the block <em>before</em> any seed is sent, so the set cannot be
              chosen after seeing the contents. <b>Consequence:</b> during the dispute
              window, anyone holding a witness that their bid was above the claimed
              clearing price can present it. The contract verifies it, cancels the auction,
              and <b>slashes the auctioneer&rsquo;s bond to the disputer</b>.
            </p>
            <p>
              So excluding a bid is not merely detectable — it is detectable by exactly the
              person with the motive to detect it, and it pays them to do so.
            </p>
            <p className="lede">
              <b>And walking away costs the bond too.</b> <code>abandon</code> does not
              return it to the seller — it forfeits it to the bidders, split evenly and
              paid out with their escrow. So discarding an outcome you do not like is not
              a cheaper alternative to excluding a bid; it costs the same stake.
            </p>
            <p>
              The bond is bounded at both ends. At least one tick, so there is always
              something at stake in a settlement bidders are asked to trust. At most the
              uniform collateral, so a bidder&rsquo;s share of a forfeited bond can never
              exceed what they staked themselves — otherwise the auction failing would be
              worth more to them than it succeeding.
            </p>
            <p className="note">
              <b>This was wrong until 30 August 2026.</b> The bond was returned to the
              seller by <code>abandon</code>, and it is pulled from the seller at listing
              — so where one address was both seller and auctioneer, discarding an outcome
              cost only gas, and it was cheaper than the exclusion attack the bond existed
              to deter. This page claimed a protection the contract did not provide. It
              was found by auditing the exit paths rather than by a failing test, and the
              tests that now cover it were written from the audit.
            </p>
          </section>

          {/* ── 4 ─────────────────────────────────────────────────────────── */}
          <section id="strk20">
            <h2 className="section">How it uses STRK20</h2>
            <p>
              Sealing the amount is the auction&rsquo;s job. STRK20 does the other half:
              unlinking the <em>bidder</em> from the bid.
            </p>
            <p>
              Bidding on the <b>public rail</b> is the ordinary path — connect, pick a
              level, sign. Your bid is sealed; your address is visible. The{" "}
              <b>private rail</b> funds the same bid from a shielded balance inside the
              STRK20 pool, so neither is visible.
            </p>
            <p>
              Our <code>AuctionAnonymizer</code> makes that atomic. The pool withdraws
              collateral to the helper, the helper forwards it into the auction and returns
              an empty span — the protocol&rsquo;s way of saying &ldquo;credit
              nothing&rdquo;, because the funds are parked, not returned. A revert anywhere
              aborts the whole pool transaction and no funds move. <b>No bidder address
              ever crosses that boundary</b>; the auction sees only the helper.
            </p>
            <p>
              Every way value comes back — a loser&rsquo;s refund, the winner&rsquo;s
              surplus, a forfeited escrow redeemed late, the lot — returns as an{" "}
              <b>open note credited inside the pool</b>. There is no public leg on the way
              out, so winning does not put an address on chain next to a price.
            </p>

            <h3>Only one rail touches the pool</h3>
            <p>
              This distinction matters more than it first looks, because the two rails
              are not two grades of the same thing.
            </p>
            <p>
              A <b>public-rail</b> bid is a direct call to the auction contract. The
              collateral moves from the bidder&rsquo;s own address, and{" "}
              <b>the STRK20 pool is not involved at any point</b>. The bid is still sealed
              — the amount was never in the calldata — but nothing private happened. It is
              an ordinary transaction that happens to carry two hashes.
            </p>
            <p>
              A <b>private-rail</b> bid is a pool transaction. The pool withdraws to the
              anonymizer, the anonymizer calls the auction, and the whole thing succeeds or
              reverts together. That is the only path where funds leave a shielded balance
              and the only one that produces a <code>Routed</code> event.
            </p>
            <p>
              So a public-rail bid can never stand in for a private one when what is being
              demonstrated is the pool integration — however many of them there are. If
              you are checking whether this project really runs against STRK20, the
              transactions to look at are the ones carrying <code>Routed</code> from the
              anonymizer <em>and</em> <code>BidPlaced</code> from the auction, in the same
              transaction.
            </p>

            <h3>What <code>Routed</code> does and does not leak</h3>
            <p>
              The anonymizer emits one event per operation. It exists because a transaction
              that touches the pool otherwise looks identical whether it came through our
              contracts or somebody else&rsquo;s.
            </p>
            <div className="cols" style={{ marginTop: "1rem" }}>
              <div className="panel">
                <p className="eyebrow">It carries</p>
                <ul className="tight">
                  <li><code>auction_id</code> — already public</li>
                  <li>the operation kind — bid, refund, forfeit, lot</li>
                </ul>
              </div>
              <div className="panel">
                <p className="eyebrow">It deliberately does not carry</p>
                <ul className="tight">
                  <li><code>note_id</code> — a pool-side handle. Publishing it would let an
                    observer tie a private note to an auction action, which is the exact
                    link the helper exists to break</li>
                  <li>the bid index on a placement — the auction emits that itself; two
                    contracts publishing the same correlator is one too many</li>
                  <li>any amount — collateral is uniform so it would leak nothing today,
                    but an event is not something a later change can take back</li>
                </ul>
              </div>
            </div>
            <p className="note" style={{ marginTop: ".9rem" }}>
              The test asserts the <em>exact</em> event, so adding a member stops the suite
              compiling rather than quietly widening what is published.
            </p>
          </section>

          {/* ── 5 ─────────────────────────────────────────────────────────── */}
          <section id="reveal">
            <h2>The reveal channel, and what it costs</h2>
            <p>
              After <code>seal()</code>, each bidder sends the auctioneer{" "}
              <code>{"{ index, seed, level }"}</code>. That is the whole payload, and it
              carries the level <b>explicitly</b> — so the auctioneer learns the exact bid.
              Removing the level would change nothing: the seed walks the hash chains, so
              anyone holding it can find the level by trying all of them.
            </p>
            <p>
              <b>There is no on-chain reveal step.</b> The word &ldquo;seed&rdquo; does not
              appear in the contract. Nothing enforces when a bidder sends it or to whom,
              and nothing can — the contract never sees it. What the contract enforces is
              the part that matters: <code>settle</code> requires the auction to be{" "}
              <code>Sealed</code>, so the bid set is fixed before any seed is legitimately
              in the auctioneer&rsquo;s hands. A bidder who reveals earlier harms only
              themselves.
            </p>

            <h3>How it actually travels</h3>
            <p>
              The bid screen copies the payload as text and you send it to the auctioneer
              over a channel you choose; the auctioneer console accepts it pasted in. That
              is the real mechanism, and it is the least convenient step in the product.
              We would rather say so than dress it up.
            </p>
            <p>
              There is also a relay at <code>/api/reveals</code> — an in-memory map on this
              site — and it is <b>disabled in production</b>. Its reads had no
              authentication: <code>GET /api/reveals?auctionId=N</code> returned every
              revealed bid for that auction to anyone who asked, and auction ids are
              sequential integers. For a site whose claim is that losing bids are never
              published, a plaintext bid feed at a guessable URL is the claim itself. It
              stays off until the read is authenticated against the auction&rsquo;s
              auctioneer address, which is not built.
            </p>
            <p className="note">
              Whatever channel you use, treat the reveal as the bid: anyone holding it can
              read the amount. It never contains your claim secret, so it cannot move your
              money — only reveal what you bid.
            </p>
          </section>

          <section id="lifecycle">
            <h2 className="section">Lifecycle and time gates</h2>
            <p>
              Two of these are deadlines a participant can miss, and missing one costs
              money. They are shown throughout the app as a countdown <em>and</em> an
              absolute UTC time, because a countdown alone cannot be quoted in a dispute.
            </p>
            <ol className="phases">
              <li><b>Open</b> — bids arrive as two hashes plus escrow. Anyone can bid.
                <span className="note"> Ends at the bid deadline.</span></li>
              <li><b>Sealed</b> — the set is frozen and stamped from the block. Bidders now
                send seeds to the auctioneer.
                <span className="note"> A seed not sent costs a delay, not the escrow.</span></li>
              <li><b>Settled</b> — the outcome is proved on-chain from N+1 witnesses.
                <span className="note"> The dispute window opens here — the only time a
                wrong outcome can be challenged.</span></li>
              <li><b>Finalized</b> — the window closed clean and funds move. The winner
                claims the lot; losers claim refunds in full.</li>
              <li><b>Cancelled</b> — a dispute succeeded, nothing was awarded, or the
                auctioneer never settled. Everything unwinds and every bidder is refunded.</li>
            </ol>
            <p>
              That last route matters. A sealed auction otherwise has exactly one way out —
              settlement, which only the auctioneer can perform — so an auctioneer who
              walks away would lock every bidder&rsquo;s collateral permanently.{" "}
              <code>abandon()</code> is a permissionless timeout: after the grace period
              anyone can cancel a sealed auction and everyone is made whole.
            </p>
          </section>

          {/* ── 6 ─────────────────────────────────────────────────────────── */}
          <section id="unshipped">
            <h2 className="section">What didn&rsquo;t ship</h2>
            <p>
              An entry that states its own gaps is worth more than one that hides them.
            </p>
            <dl className="facts">
              <div className="fact">
                <dt>Sponsored private bidding</dt>
                <dd>Designed and costed; the pool supports paying another party&rsquo;s
                  fee. No relayer is deployed, so the interface shows it and does not offer
                  it.</dd>
              </div>
              <div className="fact">
                <dt>Multi-unit auctions</dt>
                <dd>The ladder generalises to uniform-price and pay-as-bid. Only
                  single-lot first-price and Vickrey are implemented.</dd>
              </div>
              <div className="fact">
                <dt>An audit</dt>
                <dd>None of this has been audited. The anonymizer in particular is
                  app-team code that handles funds mid-transaction.</dd>
              </div>
              <div className="fact">
                <dt>The privacy SDK</dt>
                <dd>Not on public npm, so the Wallet API is the only installable route.
                  See the README for the check.</dd>
              </div>
            </dl>
          </section>

          {/* ── 7 ─────────────────────────────────────────────────────────── */}
          <section id="source">
            <h2 className="section">Source, tests, runbook</h2>
            <div className="cols">
              <div className="panel">
                <p className="eyebrow">Contracts</p>
                <ul className="tight">
                  <li><a href={`${REPO}/blob/main/packages/auction/src/auction.cairo`} target="_blank" rel="noreferrer">SealedBidAuction</a> — states, settlement, disputes</li>
                  <li><a href={`${REPO}/blob/main/packages/auction/src/ladder.cairo`} target="_blank" rel="noreferrer">ladder.cairo</a> — the two chains</li>
                  <li><a href={`${REPO}/blob/main/packages/anonymizer/src/auction_anonymizer.cairo`} target="_blank" rel="noreferrer">AuctionAnonymizer</a> — the pool sandwich</li>
                </ul>
              </div>
              <div className="panel">
                <p className="eyebrow">Checks anyone can run</p>
                <ul className="tight">
                  <li><code>snforge test</code> — 70 contract tests, negative ones first</li>
                  <li><code>npm test</code> — 50 client tests</li>
                  <li><code>npm run verify:pool</code> — our encoding against the live
                    mainnet pool, with controls that prove the check can fail</li>
                </ul>
              </div>
            </div>
            <div className="panel" style={{ marginTop: ".9rem" }}>
              <p className="eyebrow">Written down</p>
              <ul className="tight">
                <li><a href={`${REPO}/blob/main/docs/runbook.md`} target="_blank" rel="noreferrer">runbook.md</a> — the mainnet deployment, command by command</li>
                <li><a href={`${REPO}/blob/main/docs/sepolia-done.md`} target="_blank" rel="noreferrer">sepolia-done.md</a> — what must be true before mainnet</li>
                <li><a href={`${REPO}/blob/main/PHASE0.md`} target="_blank" rel="noreferrer">PHASE0.md</a> — the investigation, including what it ruled out</li>
              </ul>
            </div>
          </section>

          <div style={{ marginTop: "2rem" }}><TrustStatement /></div>
        </article>
      </div>
    </PublicShell>
  );
}
