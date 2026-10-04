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
    n: 2, title: "No amount is readable while bidding is open. The auctioneer reads them only after the set is frozen",
    hard: "Designs with a trusted auctioneer leak every bid to whoever runs the server, from the moment it arrives.",
    how: "During bidding the chain holds two hashes per bid and nothing else. After `seal()` freezes the set, each bid is posted on chain encrypted to a key the auctioneer made for this auction alone, and the auctioneer learns every exact bid. That ordering is the protection: by then the set cannot change, no bid can be added or dropped, and the clearing price is already fixed by bids nobody could edit. The encrypted bids stay on chain, so anyone who ever obtains that auction's key can read them; the auctioneer is prompted to delete it once the auction is final."
  },
  {
    n: 3, title: "The bid set is frozen before any amount can be read",
    hard: "If the party producing the result picks the set after seeing the contents, they can drop a rival's high bid and claim it never arrived.",
    how: "`seal()` stamps the block number and freezes the set on-chain. Only afterwards are bids revealed, encrypted to the auctioneer. Leaving out a bid whose reveal was posted in time is provable: that bidder can void the settlement and takes the auctioneer's bond. Sealing is permissionless — the contract checks only that the bid deadline has passed — so an auctioneer cannot stall an auction by refusing to seal it, and any bidder can start the clock themselves.",
    star: true,
  },
  {
    n: 4, title: "Losing bids are never published",
    hard: "Every commit-reveal auction ends by publishing all of them. Your valuation is a business fact, and it is still true at the next auction.",
    how: "Settlement proves the outcome from bounds. The clearing price is revealed because it is the price; every other bid stays on chain only as two hashes and a ciphertext that the auction's key opens.",
    star: true,
  },
  {
    n: 5, title: "The outcome is proved, not asserted",
    hard: "Most implementations ask you to trust that the settlement transaction did the arithmetic honestly.",
    how: "The contract verifies N+1 hash-preimage witnesses: the winner at or above the clearing level, the runner-up exactly at it, everyone else at or below. A false outcome cannot produce them.",
  },
  {
    n: 6, title: "A silent bidder is settled around, not waited for",
    hard: "In commit-reveal, a bidder who dislikes the result simply never reveals — and in a second-price auction one silent bidder moves the price the winner pays.",
    how: "Settlement needs no cooperation from a bidder whose reveal was not posted in the reveal window: their bid is marked forfeited and the auction completes without them. What they get back depends on where the bid sat — at or below the clearing price, they redeem the escrow afterwards with a late loser-side proof built from their seed; above it, redeem_forfeit cannot return it.",
  },
];
