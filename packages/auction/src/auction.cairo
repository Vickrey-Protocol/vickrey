//! Sealed-bid auctions where the losing bids are never published.
//!
//! The lifecycle is `Open -> Sealed -> Settled -> Finalized`, with `Cancelled` as the
//! unwind. Nothing moves until `finalize`, so a wrong outcome can be voided rather
//! than clawed back.
//!
//! The contract is deliberately pool-agnostic: it pulls and pushes plain ERC-20, so
//! it is fully testable with ordinary accounts and works with the STRK20 pool through
//! the anonymizer in `packages/anonymizer`.

#[starknet::contract]
pub mod SealedBidAuction {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_number, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use crate::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::interface::ISealedBidAuction;
    use crate::types::{
        AuctionConfig, AuctionKind, AuctionState, Bid, Disposition, DispositionProof, NO_WINNER,
        ProofKind, Status,
    };
    use crate::{errors, ladder};

    #[storage]
    struct Storage {
        next_id: u64,
        configs: Map<u64, AuctionConfig>,
        states: Map<u64, AuctionState>,
        bids: Map<(u64, u32), Bid>,
        /// Guards against a bid replaying another bid's anchors within one auction.
        anchor_seen: Map<(u64, felt252), bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AuctionCreated: AuctionCreated,
        BidPlaced: BidPlaced,
        Sealed: Sealed,
        Settled: Settled,
        Disputed: Disputed,
        Finalized: Finalized,
        RefundClaimed: RefundClaimed,
        LotClaimed: LotClaimed,
        Abandoned: Abandoned,
    }

    /// A sealed auction cancelled because the auctioneer never settled it. Distinct
    /// from `Finalized` with no winner: nothing was ever proved here.
    #[derive(Drop, starknet::Event)]
    pub struct Abandoned {
        #[key]
        pub auction_id: u64,
        pub bid_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AuctionCreated {
        #[key]
        pub auction_id: u64,
        #[key]
        pub seller: ContractAddress,
        pub auctioneer: ContractAddress,
        pub kind: AuctionKind,
        pub reserve_price: u128,
        pub tick: u128,
        pub num_levels: u16,
        pub collateral: u128,
        pub bid_deadline: u64,
        pub terms_hash: felt252,
    }

    /// Carries no amount and no bidder. An observer learns that a bid arrived and when.
    #[derive(Drop, starknet::Event)]
    pub struct BidPlaced {
        #[key]
        pub auction_id: u64,
        #[key]
        pub index: u32,
        pub claim_commitment: felt252,
        pub up_anchor: felt252,
        pub down_anchor: felt252,
        pub bid_root: felt252,
    }

    /// The property-3 artifact: the bid set is fixed here, publicly, before the
    /// auctioneer is sent anything it could decrypt.
    #[derive(Drop, starknet::Event)]
    pub struct Sealed {
        #[key]
        pub auction_id: u64,
        pub bid_count: u32,
        pub bid_root: felt252,
        pub sealed_at_block: u64,
        pub sealed_at_time: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Settled {
        #[key]
        pub auction_id: u64,
        pub winner_index: u32,
        pub clearing_level: u16,
        pub clearing_price: u128,
        pub forfeited: u32,
        pub dispute_deadline: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Disputed {
        #[key]
        pub auction_id: u64,
        #[key]
        pub bid_index: u32,
        pub disputer: ContractAddress,
        pub bond_slashed: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Finalized {
        #[key]
        pub auction_id: u64,
        pub proceeds: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RefundClaimed {
        #[key]
        pub auction_id: u64,
        #[key]
        pub bid_index: u32,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LotClaimed {
        #[key]
        pub auction_id: u64,
        pub amount: u128,
    }

    #[abi(embed_v0)]
    pub impl SealedBidAuctionImpl of ISealedBidAuction<ContractState> {
        fn create_auction(ref self: ContractState, config: AuctionConfig) -> u64 {
            assert(config.num_levels >= 2, errors::BAD_LEVELS);
            assert(config.num_levels <= ladder::MAX_LEVELS, errors::BAD_LEVELS);
            assert(config.tick.is_non_zero(), errors::ZERO_TICK);
            assert(config.payment_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(config.lot_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(config.lot_amount.is_non_zero(), errors::ZERO_LOT);
            assert(config.bid_deadline > get_block_timestamp(), errors::BAD_DEADLINE);
            // Nobody could ever settle it, and `abandon` would be the only way out.
            assert(config.auctioneer.is_non_zero(), errors::ZERO_AUCTIONEER);

            let seller = get_caller_address();
            let stored = AuctionConfig { seller, ..config };
            // Reject a ladder whose top price would overflow u128 before anyone can bid.
            let top = cap_price(stored);

            let id = self.next_id.read();
            self.next_id.write(id + 1);
            self.configs.entry(id).write(stored);
            self
                .states
                .entry(id)
                .write(
                    AuctionState {
                        status: Status::Open,
                        bid_count: 0,
                        bid_root: 0,
                        sealed_at_block: 0,
                        sealed_at_time: 0,
                        clearing_level: 0,
                        winner_index: NO_WINNER,
                        settled_at: 0,
                        dispute_deadline: 0,
                        lot_claimed: false,
                        proceeds_paid: false,
                    },
                );

            let this = get_contract_address();
            pull(stored.lot_token, seller, this, stored.lot_amount);
            if stored.auctioneer_bond.is_non_zero() {
                pull(stored.payment_token, seller, this, stored.auctioneer_bond);
            }

            self
                .emit(
                    AuctionCreated {
                        auction_id: id,
                        seller,
                        auctioneer: stored.auctioneer,
                        kind: stored.kind,
                        reserve_price: stored.reserve_price,
                        tick: stored.tick,
                        num_levels: stored.num_levels,
                        collateral: top,
                        bid_deadline: stored.bid_deadline,
                        terms_hash: stored.terms_hash,
                    },
                );
            id
        }

        fn place_bid(
            ref self: ContractState,
            auction_id: u64,
            claim_commitment: felt252,
            up_anchor: felt252,
            down_anchor: felt252,
        ) -> u32 {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Open, errors::NOT_OPEN);
            assert(get_block_timestamp() < config.bid_deadline, errors::BIDDING_CLOSED);
            assert(claim_commitment.is_non_zero(), errors::ZERO_COMMITMENT);

            // Copying another bid's anchors would produce a bid nobody can disposition.
            assert(!self.anchor_seen.entry((auction_id, up_anchor)).read(), errors::DUPLICATE_BID);
            assert(
                !self.anchor_seen.entry((auction_id, down_anchor)).read(), errors::DUPLICATE_BID,
            );
            self.anchor_seen.entry((auction_id, up_anchor)).write(true);
            self.anchor_seen.entry((auction_id, down_anchor)).write(true);

            let index = state.bid_count;
            let escrow = cap_price(config);
            pull(config.payment_token, get_caller_address(), get_contract_address(), escrow);

            self
                .bids
                .entry((auction_id, index))
                .write(
                    Bid {
                        claim_commitment,
                        up_anchor,
                        down_anchor,
                        escrow,
                        disposition: Disposition::Unset,
                        claimed: false,
                    },
                );

            state.bid_count = index + 1;
            state
                .bid_root =
                    ladder::extend_bid_root(
                        state.bid_root, index, claim_commitment, up_anchor, down_anchor,
                    );
            self.states.entry(auction_id).write(state);

            self
                .emit(
                    BidPlaced {
                        auction_id,
                        index,
                        claim_commitment,
                        up_anchor,
                        down_anchor,
                        bid_root: state.bid_root,
                    },
                );
            index
        }

        fn seal(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Open, errors::NOT_OPEN);
            assert(get_block_timestamp() >= config.bid_deadline, errors::BIDDING_STILL_OPEN);

            // Stamped from the block, never from a caller-supplied parameter.
            state.status = Status::Sealed;
            state.sealed_at_block = get_block_number();
            state.sealed_at_time = get_block_timestamp();
            self.states.entry(auction_id).write(state);

            self
                .emit(
                    Sealed {
                        auction_id,
                        bid_count: state.bid_count,
                        bid_root: state.bid_root,
                        sealed_at_block: state.sealed_at_block,
                        sealed_at_time: state.sealed_at_time,
                    },
                );
        }

        fn settle(
            ref self: ContractState,
            auction_id: u64,
            clearing_level: u16,
            winner_index: u32,
            proofs: Span<DispositionProof>,
        ) {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Sealed, errors::NOT_SEALED);
            assert(get_caller_address() == config.auctioneer, errors::NOT_AUCTIONEER);
            assert(proofs.len() == state.bid_count, errors::PROOF_COUNT);
            assert(clearing_level < config.num_levels, errors::BAD_LEVEL);

            let mut forfeited: u32 = 0;
            let mut runner_up_found = false;
            let mut winner_kind = ProofKind::Forfeit;
            let mut i: u32 = 0;

            while i < state.bid_count {
                let mut bid = self.bids.entry((auction_id, i)).read();
                let proof = *proofs.at(i);
                let is_winner = i == winner_index;

                match proof.kind {
                    ProofKind::AtOrAbove => {
                        // Only the winner may sit above the clearing level unpinned.
                        // Everyone else must be pinned or below, or the second price
                        // would not be determined.
                        assert(is_winner, errors::ABOVE_NOT_WINNER);
                        assert(
                            ladder::verify_at_or_above(
                                auction_id,
                                bid.claim_commitment,
                                bid.up_anchor,
                                clearing_level,
                                proof.witness_up,
                            ),
                            errors::BAD_PROOF_ABOVE,
                        );
                        bid.disposition = Disposition::AtOrAbove;
                    },
                    ProofKind::Exactly => {
                        assert(
                            ladder::verify_at_or_above(
                                auction_id,
                                bid.claim_commitment,
                                bid.up_anchor,
                                clearing_level,
                                proof.witness_up,
                            ),
                            errors::BAD_PROOF_ABOVE,
                        );
                        assert(
                            ladder::verify_at_or_below(
                                auction_id,
                                bid.claim_commitment,
                                bid.down_anchor,
                                config.num_levels,
                                clearing_level,
                                proof.witness_down,
                            ),
                            errors::BAD_PROOF_BELOW,
                        );
                        bid.disposition = Disposition::Exactly;
                        if !is_winner {
                            runner_up_found = true;
                        }
                    },
                    ProofKind::AtOrBelow => {
                        assert(
                            ladder::verify_at_or_below(
                                auction_id,
                                bid.claim_commitment,
                                bid.down_anchor,
                                config.num_levels,
                                clearing_level,
                                proof.witness_down,
                            ),
                            errors::BAD_PROOF_BELOW,
                        );
                        bid.disposition = Disposition::AtOrBelow;
                    },
                    ProofKind::Forfeit => {
                        assert(!is_winner, errors::WINNER_FORFEIT);
                        bid.disposition = Disposition::Forfeit;
                        forfeited += 1;
                    },
                }

                if is_winner {
                    winner_kind = proof.kind;
                }
                self.bids.entry((auction_id, i)).write(bid);
                i += 1;
            }

            if winner_index == NO_WINNER {
                // Nothing to award: every bid must have failed to disposition.
                assert(forfeited == state.bid_count, errors::NOT_ALL_FORFEIT);
            } else {
                assert(winner_index < state.bid_count, errors::BAD_WINNER);
                match config.kind {
                    AuctionKind::FirstPrice => {
                        // The winner pays their own bid, so that bid must be pinned.
                        assert(winner_kind == ProofKind::Exactly, errors::FIRST_PRICE_EXACT);
                    },
                    AuctionKind::Vickrey => {
                        // The price is the runner-up's bid, so *that* must be pinned.
                        // With no live runner-up the lone bidder clears at the reserve.
                        if !runner_up_found {
                            assert(forfeited + 1 == state.bid_count, errors::NO_RUNNER_UP);
                            assert(clearing_level == 0, errors::NEEDS_RESERVE);
                        }
                    },
                }
            }

            state.status = Status::Settled;
            state.clearing_level = clearing_level;
            state.winner_index = winner_index;
            state.settled_at = get_block_timestamp();
            state.dispute_deadline = get_block_timestamp() + config.dispute_window;
            self.states.entry(auction_id).write(state);

            self
                .emit(
                    Settled {
                        auction_id,
                        winner_index,
                        clearing_level,
                        clearing_price: level_price(config, clearing_level),
                        forfeited,
                        dispute_deadline: state.dispute_deadline,
                    },
                );
        }

        fn dispute(ref self: ContractState, auction_id: u64, bid_index: u32, witness_up: felt252) {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Settled, errors::NOT_SETTLED);
            assert(get_block_timestamp() < state.dispute_deadline, errors::DISPUTE_CLOSED);
            assert(bid_index < state.bid_count, errors::BAD_INDEX);
            assert(state.clearing_level + 1 < config.num_levels, errors::NO_DISPUTE_ABOVE_TOP);

            // Strictly above the clearing level: this bid should have changed the
            // outcome and did not.
            let bid = self.bids.entry((auction_id, bid_index)).read();
            assert(
                ladder::verify_at_or_above(
                    auction_id,
                    bid.claim_commitment,
                    bid.up_anchor,
                    state.clearing_level + 1,
                    witness_up,
                ),
                errors::BAD_PROOF_ABOVE,
            );

            state.status = Status::Cancelled;
            self.states.entry(auction_id).write(state);

            let disputer = get_caller_address();
            if config.auctioneer_bond.is_non_zero() {
                push(config.payment_token, disputer, config.auctioneer_bond);
            }
            // The lot goes home; every bid becomes refundable in full, forfeits included.
            push(config.lot_token, config.seller, config.lot_amount);

            self
                .emit(
                    Disputed {
                        auction_id, bid_index, disputer, bond_slashed: config.auctioneer_bond,
                    },
                );
        }

        fn finalize(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Settled, errors::NOT_SETTLED);
            assert(get_block_timestamp() >= state.dispute_deadline, errors::DISPUTE_OPEN);

            let mut proceeds: u128 = 0;
            if state.winner_index == NO_WINNER {
                // Nothing was awarded. The lot goes back; every bid keeps its escrow.
                push(config.lot_token, config.seller, config.lot_amount);
                state.status = Status::Cancelled;
            } else {
                let price = level_price(config, state.clearing_level);
                let mut winner = self.bids.entry((auction_id, state.winner_index)).read();
                // The winner's escrow now owes them only the surplus. In a Vickrey
                // auction that surplus is bid minus clearing price, and refunding it
                // privately is what keeps the winning bid unpublished too.
                winner.escrow = winner.escrow - price;
                self.bids.entry((auction_id, state.winner_index)).write(winner);
                proceeds = price;
                state.status = Status::Finalized;
                state.proceeds_paid = true;
            }

            self.states.entry(auction_id).write(state);

            if proceeds.is_non_zero() {
                push(config.payment_token, config.seller, proceeds);
            }
            if config.auctioneer_bond.is_non_zero() {
                push(config.payment_token, config.seller, config.auctioneer_bond);
            }

            self.emit(Finalized { auction_id, proceeds });
        }

        /// Cancels a sealed auction the auctioneer abandoned.
        ///
        /// Permissionless on purpose. The people with funds trapped in it are the
        /// bidders, and requiring the auctioneer's cooperation to escape the
        /// auctioneer's absence would be no escape at all.
        ///
        /// The grace period is the auction's own `dispute_window`, rather than a new
        /// config field or a fixed constant. It is already the parameter that says how
        /// long this auction expects things to take, it is public at listing so a
        /// bidder can read it before committing, and it scales the same way: a demo
        /// with a 180-second window gives the auctioneer three minutes to settle, a
        /// real auction with a day gives them a day.
        ///
        /// Cancelling refunds every bidder in full — forfeits included, since no
        /// settlement ever established who forfeited — and returns the lot and the
        /// bond to the seller. Losing an auction to a slow auctioneer is a bad outcome;
        /// losing the money is not one this contract will allow.
        fn abandon(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Sealed, errors::NOT_SEALED);
            assert(
                get_block_timestamp() >= state.sealed_at_time + config.dispute_window,
                errors::SETTLE_GRACE_OPEN,
            );

            state.status = Status::Cancelled;
            self.states.entry(auction_id).write(state);

            // The lot goes home. Bidders reclaim their own escrow through
            // `claim_refund`, which accepts Cancelled and pays out on the claim secret.
            push(config.lot_token, config.seller, config.lot_amount);
            if config.auctioneer_bond.is_non_zero() {
                // Returned, not slashed. The bond answers for a dishonest settlement,
                // and there was no settlement; the seller posted it, and the seller has
                // already lost the sale.
                push(config.payment_token, config.seller, config.auctioneer_bond);
            }

            self.emit(Abandoned { auction_id, bid_count: state.bid_count });
        }

        fn claim_refund(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            claim_secret: felt252,
            recipient: ContractAddress,
        ) -> u128 {
            let config = self.load_config(auction_id);
            let state = self.states.entry(auction_id).read();
            assert(
                state.status == Status::Finalized || state.status == Status::Cancelled,
                errors::NOT_FINAL,
            );
            assert(bid_index < state.bid_count, errors::BAD_INDEX);

            let mut bid = self.bids.entry((auction_id, bid_index)).read();
            // A cancelled auction refunds everyone, forfeits included.
            if state.status == Status::Finalized {
                assert(bid.disposition != Disposition::Forfeit, errors::IS_FORFEIT);
            }
            let amount = self.take(auction_id, bid_index, ref bid, claim_secret);
            push(config.payment_token, recipient, amount);
            self.emit(RefundClaimed { auction_id, bid_index, amount });
            amount
        }

        fn redeem_forfeit(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            claim_secret: felt252,
            witness_down: felt252,
            recipient: ContractAddress,
        ) -> u128 {
            let config = self.load_config(auction_id);
            let state = self.states.entry(auction_id).read();
            assert(state.status == Status::Finalized, errors::NOT_FINAL);
            assert(bid_index < state.bid_count, errors::BAD_INDEX);

            let mut bid = self.bids.entry((auction_id, bid_index)).read();
            assert(bid.disposition == Disposition::Forfeit, errors::NOT_FORFEIT);
            // Late, self-served version of the loser-side proof the auctioneer could
            // not produce. Going offline costs a delay, not the money.
            assert(
                ladder::verify_at_or_below(
                    auction_id,
                    bid.claim_commitment,
                    bid.down_anchor,
                    config.num_levels,
                    state.clearing_level,
                    witness_down,
                ),
                errors::BAD_PROOF_BELOW,
            );

            let amount = self.take(auction_id, bid_index, ref bid, claim_secret);
            push(config.payment_token, recipient, amount);
            self.emit(RefundClaimed { auction_id, bid_index, amount });
            amount
        }

        fn claim_lot(
            ref self: ContractState,
            auction_id: u64,
            claim_secret: felt252,
            recipient: ContractAddress,
        ) -> u128 {
            let config = self.load_config(auction_id);
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Finalized, errors::NOT_FINAL);
            assert(state.winner_index != NO_WINNER, errors::NO_WINNER_SET);
            assert(!state.lot_claimed, errors::ALREADY_CLAIMED);

            let bid = self.bids.entry((auction_id, state.winner_index)).read();
            assert(
                ladder::claim_commitment_of(claim_secret) == bid.claim_commitment,
                errors::BAD_SECRET,
            );

            state.lot_claimed = true;
            self.states.entry(auction_id).write(state);
            push(config.lot_token, recipient, config.lot_amount);
            self.emit(LotClaimed { auction_id, amount: config.lot_amount });
            config.lot_amount
        }

        fn get_config(self: @ContractState, auction_id: u64) -> AuctionConfig {
            self.load_config(auction_id)
        }

        fn get_state(self: @ContractState, auction_id: u64) -> AuctionState {
            self.states.entry(auction_id).read()
        }

        fn get_bid(self: @ContractState, auction_id: u64, index: u32) -> Bid {
            self.bids.entry((auction_id, index)).read()
        }

        fn collateral(self: @ContractState, auction_id: u64) -> u128 {
            cap_price(self.load_config(auction_id))
        }

        fn price_of_level(self: @ContractState, auction_id: u64, level: u16) -> u128 {
            let config = self.load_config(auction_id);
            assert(level < config.num_levels, errors::BAD_LEVEL);
            level_price(config, level)
        }

        fn auction_count(self: @ContractState) -> u64 {
            self.next_id.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn load_config(self: @ContractState, auction_id: u64) -> AuctionConfig {
            let config = self.configs.entry(auction_id).read();
            assert(config.payment_token.is_non_zero(), errors::NOT_FOUND);
            config
        }

        /// Authorizes by claim secret, zeroes the bid's balance and returns it.
        fn take(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            ref bid: Bid,
            claim_secret: felt252,
        ) -> u128 {
            assert(
                ladder::claim_commitment_of(claim_secret) == bid.claim_commitment,
                errors::BAD_SECRET,
            );
            assert(!bid.claimed, errors::ALREADY_CLAIMED);
            let amount = bid.escrow;
            bid.claimed = true;
            bid.escrow = 0;
            self.bids.entry((auction_id, bid_index)).write(bid);
            amount
        }
    }

    /// Price at a ladder level. Level 0 is the reserve, so bidding at all means
    /// bidding at least the reserve.
    fn level_price(config: AuctionConfig, level: u16) -> u128 {
        let step = config.tick * level.into();
        assert(step / config.tick == level.into(), errors::PRICE_OVERFLOW);
        let price = config.reserve_price + step;
        assert(price >= config.reserve_price, errors::PRICE_OVERFLOW);
        price
    }

    /// What every bidder escrows. Uniform across bidders, so the escrow leaks nothing
    /// about the bid behind it. See PHASE0.md Q1.
    fn cap_price(config: AuctionConfig) -> u128 {
        level_price(config, config.num_levels - 1)
    }

    fn pull(token: ContractAddress, from: ContractAddress, to: ContractAddress, amount: u128) {
        let ok = IERC20Dispatcher { contract_address: token }
            .transfer_from(sender: from, recipient: to, amount: amount.into());
        assert(ok, errors::TRANSFER_FAILED);
    }

    fn push(token: ContractAddress, to: ContractAddress, amount: u128) {
        let ok = IERC20Dispatcher { contract_address: token }
            .transfer(recipient: to, amount: amount.into());
        assert(ok, errors::TRANSFER_FAILED);
    }
}
