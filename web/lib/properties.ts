/**
 * The six properties, and why each is hard.
 *
 * One source for two pages: the reference lists them in full, the landing page sets
 * them in a grid. Two copies would drift, and a property that reads differently on the
 * two pages is a claim nobody can check.
 */
export interface Property {
  n: number;
  title: string;
  /** What normally goes wrong. */
  hard: string;
  /** What this design does instead. */
  how: string;
  /** The two that are genuinely hard to get elsewhere. */
  star?: boolean;
}

export const PROPERTIES: Property[] = [
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
