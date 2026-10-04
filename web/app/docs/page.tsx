import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";
import { Thermometer } from "@/components/docs/Thermometer";
import { TrustStatement } from "@/components/TrustStatement";
import { PROPERTIES } from "@/lib/properties";

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
  ["custody", "Where your assets are"],
  ["tokens", "Which tokens work"],
  ["strk20", "How it uses STRK20"],
  ["reveal", "The reveal channel"],
  ["disclosure", "Disclosure: the relay"],
  ["lifecycle", "Lifecycle and time gates"],
  ["unshipped", "What didn't ship"],
  ["source", "Source, tests, runbook"],
] as const;

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
          {/* Above everything else in the reference, because a reader who is about to bid
              needs it before they read how bidding works. */}
          <div className="banner" style={{ borderColor: "var(--accent-edge)" }}>
            <b>Fixed defect, 7&ndash;8 Sep 2026 &mdash; saved bids were being deleted by other
            tabs.</b>{" "}
            The claim secret and seed a bid generates are stored in this browser and nowhere
            else. The dashboard&rsquo;s reconciler checked each stored bid against the chain
            with a search bounded by a <em>polled</em> bid count, which just after a bid is
            short by exactly that bid &mdash; so the search stopped one index before it and
            read &ldquo;not found&rdquo; as proof. It ran every 20 seconds in every tab with
            the dashboard open. Four tabs were open during the mainnet bids; six seeds went
            in twenty-second intervals. Fixing the reconciler was not enough: a tab opened
            before the deploy kept running the old code. So the store now refuses to remove a
            bid without proof, current tabs restore anything an older tab deletes, and the app
            names an older tab and asks for it to be reloaded. If you see that notice, do
            what it says. A second path to the same loss was found on 4 Oct 2026 and is fixed
            in this version: cleaning up a failed bid attempt stored at the same index as a
            bid that landed could take the landed bid&rsquo;s secret with it. Clean-up now
            names the one bid by its commitment. The full account, including what it cost us, is in{" "}
            <a href={`${REPO}#disclosure--7-sep-2026-the-claim-secret-does-not-reliably-persist`}
               target="_blank" rel="noreferrer">the README disclosure</a>.
          </div>

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
              <b>Vickrey never publishes a losing bid.</b> Collateral is escrowed up front, and
              a bid that is not revealed in time is settled around, not waited for. The winner
              and the price are proved with hash chains instead of disclosure. On chain, a
              losing bid is two hashes and a ciphertext that only the auction&rsquo;s key opens.
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
                  <li>Every other bid is still two hashes and a ciphertext encrypted to the
                    auction&rsquo;s key — including the winner&rsquo;s own</li>
                  <li>A bid whose reveal is not posted in time is marked forfeited and
                    settlement proceeds without it. What the bidder gets back depends on
                    where the bid sat</li>
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
              sealing before reveal, reveals posted on chain, and the auctioneer&rsquo;s bond
              are for.
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
              than they intend to spend. The difference comes back at settlement. It is
              designed to come back on the private rail as a note inside the pool, so even
              the refund would not reveal how much was unspent; that path is waiting on the
              pool, and for now every refund is collected publicly.
            </p>

            <h3>A bid that is not revealed is settled around, not waited for</h3>
            <p>
              In commit–reveal, a bidder who dislikes the result simply never reveals. In a
              second-price auction that is not a small problem: the runner-up going quiet
              changes what the winner pays. So non-reveal is an attack, and it is free.
            </p>
            <p>
              Here each bid is revealed after the seal: its seed and level are posted on
              chain, encrypted to the auctioneer&rsquo;s key for that auction, by
              Vickrey&rsquo;s relay or by the bidder. A bid whose reveal is not posted within
              the reveal window is marked <b>forfeited</b> and settlement proceeds without it. The auction does not wait, does not stall,
              and does not need their cooperation.
            </p>
            <p className="note">
              What the bidder gets back depends on where their bid sat. <b>At or below the
              clearing price</b>, they can build the loser-side proof from their seed after the
              auction finalizes, and <code>redeem_forfeit</code> returns the escrow in full:
              going quiet cost them a delay. <b>Above the clearing price</b>,{" "}
              <code>redeem_forfeit</code> cannot return it.
            </p>

            <h3>Forfeited escrow stays in the contract, deliberately</h3>
            <p>
              Read the contract and you will find money that can never come out. A bid
              whose anchors match no rung — which <code>place_bid</code> cannot detect,
              because it is handed two hashes and never a level — is marked forfeited at
              settlement, and its escrow then sits there permanently. No claim path
              releases it: <code>collect</code> refuses a forfeited bid,{" "}
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
              there is nothing to gain by declaring one. Someone honest who went offline
              with a bid at or below the clearing price is not stranded: they can produce
              the loser-side proof late, and <code>redeem_forfeit</code> returns their
              escrow in full. Which escrow does stay in the contract is set out under the
              lot question below.
            </p>
            <p className="note">
              Four end-to-end tests cover this, and a conservation test asserts the
              contract holds nothing at all once an ordinary auction has been claimed out.
            </p>

            <h3>Leaving a bid out is on the record</h3>
            <p>
              The auctioneer learns every level after sealing. The obvious attack is to
              pretend a high bid never arrived, settle lower, and win the lot cheaply — or
              hand it to a friend.
            </p>
            <p>
              <b>Ordering</b> limits it: <code>seal()</code> freezes the set and stamps the
              block <em>before</em> any bid is revealed, so the set cannot be chosen after
              seeing the contents. Each reveal is then posted on chain, encrypted to the
              auctioneer, inside a reveal window that closes before settlement can start. A
              reveal posted in time is a public record that the auctioneer had the bid.
            </p>
            <p className="lede">
              If the settlement marks a bid forfeited although its reveal was posted in time,
              and the bid beat the clearing price or the settlement named no winner, that
              bidder can void the settlement while the dispute window is open. The auction is
              cancelled, every escrow comes back, and the auctioneer&rsquo;s bond is added to
              that bidder&rsquo;s escrow.
            </p>
            <p>
              Voiding opens that one bid&rsquo;s reveal, so its amount becomes public. Only a
              bid the settlement wronged can do it: the winner&rsquo;s bid, a bid that was
              ranked, or one whose reveal was never posted cannot.
            </p>
            <p>
              Walking away is not free: <code>abandon</code> forfeits the auctioneer&rsquo;s
              bond to the bidders, split evenly and paid out with their escrow.
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
          <section id="custody">
            <h2>Where your assets are, state by state</h2>
            <p>
              Both the lot and every escrow sit in the auction contract itself. It is not a
              vault contract or a multisig — it is the same contract that runs the auction,
              and nothing but the paths below moves anything out of it.
            </p>

            <h3>The lot</h3>
            <p>
              The seller&rsquo;s <b>full</b> lot — an amount of a token, or one NFT — is pulled
              at <code>create_auction</code>, before the auction is visible to anyone. There is
              no partial or lazy funding: an unfunded listing does not exist. An off-chain lot
              is not held by anyone; its delivery escrow is set out below.
            </p>
            <div className="scroller">
              <table>
                <thead><tr><th>Status</th><th>Where the lot is</th><th>Who can move it, and how</th></tr></thead>
                <tbody>
                  <tr><td><b>Open</b></td><td>The contract</td>
                    <td><b>Nobody.</b> No entrypoint moves the lot while bidding is open —
                      not the seller, not the auctioneer, not us.</td></tr>
                  <tr><td><b>Sealed</b></td><td>The contract</td>
                    <td><b>Anyone</b>, via <code>abandon</code>, once the grace has expired
                      (the reveal window, then the dispute window, after the seal). The
                      auction is cancelled.</td></tr>
                  <tr><td><b>Settled</b></td><td>The contract</td>
                    <td>A bidder the settlement left out, via <code>dispute</code> while the
                      window is open — the auction is cancelled. Or <b>anyone</b> via{" "}
                      <code>finalize</code> once the window closes.</td></tr>
                  <tr><td><b>Finalized</b></td><td>The contract</td>
                    <td><b>The winner only</b>, via <code>collect</code>, by presenting the
                      claim secret. Once, and to any recipient they name; an NFT always goes
                      to a public address.</td></tr>
                  <tr><td><b>Cancelled</b></td><td>The contract, owed to the seller</td>
                    <td><b>Anyone</b>, via <code>reclaim_lot</code>, which only ever sends it
                      to the seller. All three routes to Cancelled — dispute, abandon, and
                      finalize with no winner — make it reclaimable.</td></tr>
                </tbody>
              </table>
            </div>

            <h3>Escrowed payment</h3>
            <p>
              One escrow per bid, pulled at <code>place_bid</code>, always the top of the
              ladder so the amount transferred says nothing about the bid behind it.
            </p>
            <div className="scroller">
              <table>
                <thead><tr><th>Status</th><th>Where it is</th><th>Who can move it, and how</th></tr></thead>
                <tbody>
                  <tr><td><b>Open / Sealed</b></td><td>The contract</td>
                    <td><b>Nobody.</b> Not even the bidder — there is no withdraw.</td></tr>
                  <tr><td><b>Settled</b></td><td>The contract</td>
                    <td><b>Nobody.</b> <code>settle</code> moves no money at all; it only
                      records the outcome and opens the dispute window.</td></tr>
                  <tr><td><b>Finalized</b></td><td>The contract</td>
                    <td>The clearing price has already left the <i>winner&rsquo;s</i> escrow
                      inside <code>finalize</code>: owed to the seller, who takes it with{" "}
                      <code>withdraw_seller</code>, or held in the delivery escrow for an
                      off-chain lot. What remains is claimable only by whoever holds each
                      bid&rsquo;s claim secret: <code>collect</code> for a loser&rsquo;s full
                      escrow or the winner&rsquo;s surplus, <code>redeem_forfeit</code> for a
                      bid marked forfeited at or below the clearing price.</td></tr>
                  <tr><td><b>Cancelled</b></td><td>The contract</td>
                    <td>Every bid collects in full through <code>collect</code>, forfeits
                      included — no settlement ever established who forfeited. If the auction
                      was abandoned with bids in it, each claim also carries an equal share of
                      the forfeited bond. If a dispute cancelled it, the disputer&rsquo;s bid
                      also carries the whole bond.</td></tr>
                </tbody>
              </table>
            </div>

            <h3>The bond</h3>
            <p>
              Pulled from the <b>seller</b> at listing, despite the name — seller and
              auctioneer may be different addresses. It goes to a successful disputer&rsquo;s
              escrow, back to the seller on <code>finalize</code> (taken with{" "}
              <code>withdraw_seller</code>), back to the seller on <code>abandon</code> if
              nobody bid, and otherwise into a pot split equally among the bidders as they
              collect.
            </p>

            <h3>An off-chain lot: the delivery escrow</h3>
            <p>
              The contract holds nothing of the item. It holds the seller&rsquo;s bond from
              listing and, after <code>finalize</code>, the clearing price. When the winner
              collects, they name a buyer address; only that address can confirm or reject
              delivery, and only before the delivery deadline.
            </p>
            <ul className="tight">
              <li><b>Confirm</b> pays the price and the seller&rsquo;s bond to the seller.</li>
              <li><b>Reject</b> locks both in the contract for good. The buyer&rsquo;s payment
                does not come back — it is destroyed — and the seller loses the bond. Neither
                side gains from either answer, which is what keeps both honest.</li>
              <li><b>Neither</b>: once the deadline passes, anyone can release the price and
                the bond to the seller.</li>
            </ul>

            <h3>Is there a state where the lot is stuck?</h3>
            <p>
              <b>Yes, one.</b> <b>Finalized, with a winner who has lost their claim secret.</b>{" "}
              The lot is claimable only by presenting it, no path returns it to the seller
              after finalization, and nothing sweeps it on a timer. It stays in the contract
              permanently. The same is true of that bid&rsquo;s surplus.
            </p>
            <p>
              Two escrow cases end the same way: a bid whose anchors match no rung, which
              can never produce the witness <code>redeem_forfeit</code> requires; and a bid
              that was forfeited while sitting <i>above</i> the clearing level, which{" "}
              <code>redeem_forfeit</code> cannot return once the auction is finalized.
            </p>
            <p className="note">
              One near-miss worth naming rather than hiding: an auction left <b>Open</b>{" "}
              forever holds the lot with no path out, because <code>abandon</code> requires{" "}
              <code>Sealed</code>. It is not actually stuck — <code>seal</code> is
              permissionless and callable by anyone the moment the bid deadline passes,
              which puts it on the road to <code>abandon</code>. But it takes somebody
              choosing to act, and nothing forces them to.
            </p>
          </section>

          <section id="tokens">
            <h2>Which tokens work, and which quietly do not</h2>
            <p>
              The contract accepts <b>any ERC-20</b> as payment or lot, and any ERC-721 as a
              lot. There is no allowlist and no decimals constraint; a lot token must answer
              as the kind it is listed as, and every ERC-20 pull is checked for what arrived. Decimals are read from the token itself
              everywhere they are displayed, never assumed.
            </p>

            <h3>Fee-on-transfer tokens are refused; rebasing tokens are not</h3>
            <p>
              Every amount here is a <b>number the contract recorded</b>. In this version every
              pull also measures what actually arrived — the contract&rsquo;s balance before
              and after — and reverts if it is short. A fee-on-transfer token is therefore
              refused at listing and at bidding, before anything is booked. Two tests cover
              it with a deliberately hostile token.
            </p>
            <p>
              A <b>rebasing</b> token is not caught: it changes balances after the transfer,
              and the contract never re-reads them. When it rebases down, a later
              claimant&rsquo;s transfer can fail; when it rebases up, the surplus belongs to no
              bid and no path sweeps it.
            </p>
            <h3>It can affect other auctions, not just its own</h3>
            <p>
              One contract holds every auction&rsquo;s funds in one balance per token, so a
              rebasing token&rsquo;s shortfall is not paid by whoever listed it. The claims
              that come first succeed out of the pooled balance, and the last
              claimant&rsquo;s transfer fails — on an auction that may never have dealt with
              the person who caused it. Choosing a well-behaved token protects you from your
              own mistake, not from someone else&rsquo;s.
            </p>
            <p className="note">
              There is no allowlist, deliberately: it would make us the arbiter of which
              assets may be auctioned. <b>Use standard, non-rebasing ERC-20s.</b> STRK and
              ordinary tokens are fine. If you are listing something unusual, check how it
              behaves first.
            </p>
            <p className="note">
              The contract supports a lot token and a payment token that differ. The create
              form here submits the same address for both, which is a simplification of the
              interface and not of the protocol.
            </p>
          </section>

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
              surplus, a forfeited escrow redeemed late, the lot — is built to return as an{" "}
              <b>open note credited inside the pool</b>, with no public leg on the way out.
              That path is not available yet: the pool screens open-note deposits from
              contracts it hasn&rsquo;t cleared, and it hasn&rsquo;t cleared the
              anonymizer. Until it does, every collect is public, and collecting links the
              collecting address to the auction.
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
            <h2>The reveal, and what it costs</h2>
            <p>
              After <code>seal()</code>, each bid&rsquo;s <code>{"{ seed, level }"}</code> is
              encrypted to a public key the auctioneer published with the listing, made fresh
              for that one auction, and posted on chain with <code>post_reveal</code>. The
              auctioneer decrypts it with the matching secret key and so learns the exact bid.
              Nobody without that key can read it.
            </p>
            <p>
              <b>The reveal window is enforced on chain.</b> <code>post_reveal</code> is
              accepted only between the seal and the reveal deadline, and{" "}
              <code>settle</code> only after it. A bid whose reveal is not posted by the
              deadline is settled as forfeited. A posted reveal is checked against the
              bid&rsquo;s own anchors wherever it counts, so an invented one changes nothing.
            </p>

            <h3>How it travels</h3>
            <p>
              Vickrey&rsquo;s relay posts each reveal from its own account, so your wallet is
              not attached to it. The relay can fail to post, but it cannot alter a reveal or
              move anything. If it has not posted, the bid page offers to post it from your
              wallet, which puts your address next to your bid index on chain. Not your
              amount.
            </p>
            <p className="note">
              <b>What this costs.</b> The encrypted bids stay on chain permanently, so anyone
              who ever obtains an auction&rsquo;s secret key can read every bid in it. The key
              is generated in the auctioneer&rsquo;s browser for that auction alone and saved
              as a file, and the console prompts the auctioneer to delete it once the auction
              is final. A reveal never contains your claim secret, so it cannot move your
              money — only show what you bid.
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
              <li><b>Sealed</b> — the set is frozen and stamped from the block. Each bid&rsquo;s
                reveal is posted on chain, encrypted to the auctioneer, until the reveal
                deadline.
                <span className="note"> A reveal not posted in time marks the bid forfeited: at
                or below the clearing price that costs a delay; above it,{" "}
                <code>redeem_forfeit</code> cannot return the escrow.</span></li>
              <li><b>Settled</b> — the outcome is proved on-chain from N+1 witnesses.
                <span className="note"> The dispute window opens here — the only time a bid
                left out of the settlement can void it.</span></li>
              <li><b>Finalized</b> — the window closed clean. The winner collects the lot and
                their surplus; every other bid collects its escrow in full. For an off-chain
                lot, the price waits in the delivery escrow.</li>
              <li><b>Cancelled</b> — a dispute succeeded, nothing was awarded, or the
                auctioneer never settled. Everything unwinds and every bid collects its
                escrow in full.</li>
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
          <section id="disclosure">
            <h2>Disclosure: we shipped an endpoint that exposed every revealed bid</h2>
            <p className="note">Found and fixed 30 August 2026.</p>
            <p>
              The off-chain reveal relay of the first version had a read endpoint —{" "}
              <code>GET /api/reveals?auctionId=N</code> — with <b>no authentication of any
              kind</b>. It returned every reveal posted for that auction, each carrying the
              bidder&rsquo;s exact level, in plaintext, to anyone who asked. Auction ids are
              sequential integers, so finding them required no guessing worth the name.
            </p>
            <p>
              For the window between a bidder revealing and the auctioneer settling, on any
              auction whose bidders used the relay, <b>every bid amount was public</b> — on
              a site whose central claim is that losing bids are never published. The chain
              never held those amounts. We did.
            </p>

            <h3>What was affected, and what was not</h3>
            <p>
              Only reveals posted through the relay, and only after sealing. It never held
              a claim secret, so no funds were ever reachable through it, and it could not
              alter an outcome: every reveal is re-checked against the anchors the chain
              stores. The exposure was of information, not of money — but the information
              is the product.
            </p>

            <h3>How it was found</h3>
            <p>
              By auditing the reveal <i>channel</i> rather than the contract, after a
              lifecycle review asked where <code>{"{ index, seed, level }"}</code> actually
              goes. The route&rsquo;s own comment claimed &ldquo;the worst it can do is
              withhold a reveal&rdquo; — reasoning carefully about the write path and never
              asking what the read path exposed. Every contract audit we had run would have
              passed, because the defect was not in the contract.
            </p>

            <h3>The bar this failed</h3>
            <p>
              Worth stating plainly, because otherwise a reader cannot tell whether the
              standard we fell short of was one anybody holds. <b>The other entries in
              this RFP publish every bid at reveal, by design.</b> Commit&ndash;reveal ends
              with each bid posted on chain so the contract can check it against its hash;
              that is not a defect in those designs, it is how they work.
            </p>
            <p>
              So the property we broke for a few days is one nobody else in the category is
              attempting at all. That cuts both ways and we would rather say both. It is
              not an excuse — we shipped a leak on the one path we claim to protect, and a
              claim you only keep by accident is not a claim. It is the context: the bar
              was ours, we set it higher than the field, we failed it in a place we had
              not looked, and we found it by going looking.
            </p>

            <h3>What changed</h3>
            <p>
              The relay was switched off the day it was found, and reveals went back to
              copy-and-paste. In the second version of the contracts it is gone: each reveal
              is posted on chain, encrypted to the auctioneer&rsquo;s key for that auction, so
              no server ever holds a bid in plaintext.
            </p>
          </section>

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
