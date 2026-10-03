//! Sealed-bid auctions where the losing bids are never published.
//!
//! The lifecycle is `Open -> Sealed -> Settled -> Finalized`, with `Cancelled` as the
//! unwind. Nothing moves until `finalize`, so a wrong outcome can be voided rather
//! than clawed back.
//!
//! v2, against v1:
//!
//! - **Lots** can be an ERC-20 amount, an ERC-721 token, or an off-chain item whose
//!   price is held in a delivery escrow (`LotKind`).
//! - **Reveals go on chain**, encrypted to the auctioneer (`reveal.cairo`), so whether
//!   the auctioneer had a bid is a fact the contract can check. `dispute` requires it.
//! - **One `collect` per bid** pays everything the bid is owed. The claim secret is in
//!   calldata, so no asset it unlocks may outlive its first use.
//! - **The seller is paid by pull**, never inline. A token that refuses the seller, or a
//!   lot token that reverts, cannot block a dispute, an abandon or a finalize.
//!
//! `AuctionConfig`, `AuctionState` and `Bid` serialize exactly as in v1; everything new
//! lives in separate maps with their own getters.
//!
//! The contract is deliberately pool-agnostic: it pulls and pushes plain ERC-20, so
//! it is fully testable with ordinary accounts and works with the STRK20 pool through
//! the anonymizer in `packages/anonymizer`.

#[starknet::contract]
pub mod SealedBidAuction {
    use core::num::traits::Zero;
    use core::panic_with_felt252;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_number, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use crate::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::erc721::{IERC721Dispatcher, IERC721DispatcherTrait};
    use crate::interface::ISealedBidAuction;
    use crate::types::{
        AuctionConfig, AuctionExtras, AuctionKind, AuctionState, Bid, Delivery, DeliveryOutcome,
        Disposition, DispositionProof, LotKind, NO_BID, NO_WINNER, ProofKind, Status,
    };
    use crate::{errors, ladder, reveal};

    #[storage]
    struct Storage {
        /// Bond forfeited by `abandon`, waiting to be paid out through `collect`.
        ///
        /// A separate map rather than a field on `AuctionState`, because clients read
        /// that struct positionally and adding a member would shift every index after
        /// it. Zero for every auction that did not end in abandonment.
        bond_pot: Map<u64, u128>,
        next_id: u64,
        configs: Map<u64, AuctionConfig>,
        states: Map<u64, AuctionState>,
        bids: Map<(u64, u32), Bid>,
        /// `index + 1` of the bid carrying an anchor; zero when no bid does. Guards
        /// against a bid replaying another bid's anchors, and answers `bid_index_of`.
        anchor_seen: Map<(u64, felt252), u32>,
        extras: Map<u64, AuctionExtras>,
        deliveries: Map<u64, Delivery>,
        /// Payment token owed to the seller, paid out by `withdraw_seller`.
        owed: Map<u64, u128>,
        /// An unsold on-chain lot waiting for `reclaim_lot`.
        lot_returnable: Map<u64, bool>,
        lot_returned: Map<u64, bool>,
        /// `reveal::record(eph_x, c_seed, c_level)` for every reveal posted per bid.
        reveals: Map<(u64, u32, felt252), bool>,
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
        LotEscrowed: LotEscrowed,
        LotTerms: LotTerms,
        RevealPosted: RevealPosted,
        SellerPaid: SellerPaid,
        LotReclaimed: LotReclaimed,
        DeliveryConfirmed: DeliveryConfirmed,
        DeliveryRejected: DeliveryRejected,
        ProceedsReleased: ProceedsReleased,
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

    /// What the contract now holds as the lot. Absent for an off-chain lot.
    #[derive(Drop, starknet::Event)]
    pub struct LotEscrowed {
        #[key]
        pub auction_id: u64,
        pub kind: LotKind,
        pub token: ContractAddress,
        pub token_id: u256,
        pub amount: u128,
    }

    /// The full terms text, published once. `terms_hash` in the config is its hash.
    #[derive(Drop, starknet::Event)]
    pub struct LotTerms {
        #[key]
        pub auction_id: u64,
        pub terms: ByteArray,
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

    /// A reveal, encrypted to the auctioneer's key. Only the auctioneer can read it.
    #[derive(Drop, starknet::Event)]
    pub struct RevealPosted {
        #[key]
        pub auction_id: u64,
        #[key]
        pub bid_index: u32,
        pub eph_x: felt252,
        pub c_seed: felt252,
        pub c_level: felt252,
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

    /// No caller address: the bond is credited to the bid, and whoever sent the
    /// transaction is not part of the record.
    #[derive(Drop, starknet::Event)]
    pub struct Disputed {
        #[key]
        pub auction_id: u64,
        #[key]
        pub bid_index: u32,
        pub bond_credited: u128,
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

    #[derive(Drop, starknet::Event)]
    pub struct SellerPaid {
        #[key]
        pub auction_id: u64,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LotReclaimed {
        #[key]
        pub auction_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DeliveryConfirmed {
        #[key]
        pub auction_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DeliveryRejected {
        #[key]
        pub auction_id: u64,
        pub price_locked: u128,
        pub bond_locked: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProceedsReleased {
        #[key]
        pub auction_id: u64,
    }

    #[abi(embed_v0)]
    pub impl SealedBidAuctionImpl of ISealedBidAuction<ContractState> {
        fn create_auction(
            ref self: ContractState, config: AuctionConfig, extras: AuctionExtras, terms: ByteArray,
        ) -> u64 {
            assert(config.num_levels >= 2, errors::BAD_LEVELS);
            assert(config.num_levels <= ladder::MAX_LEVELS, errors::BAD_LEVELS);
            assert(config.tick.is_non_zero(), errors::ZERO_TICK);
            assert(config.payment_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(config.bid_deadline > get_block_timestamp(), errors::BAD_DEADLINE);
            // Nobody could ever settle it, and `abandon` would be the only way out.
            assert(config.auctioneer.is_non_zero(), errors::ZERO_AUCTIONEER);
            // A bond of zero leaves nothing at stake in a settlement bidders are asked
            // to trust. One tick is the smallest amount that makes moving the outcome by
            // a single level cost something.
            assert(config.auctioneer_bond >= config.tick, errors::BOND_TOO_SMALL);

            // Bidders encrypt their reveals to this key. Off the curve, nobody could.
            assert(
                reveal::valid_key(extras.reveal_key_x, extras.reveal_key_y), errors::BAD_REVEAL_KEY,
            );
            // With no window, no reveal could ever be posted and no exclusion disputed.
            assert(extras.reveal_window.is_non_zero(), errors::ZERO_REVEAL_WINDOW);

            match extras.lot_kind {
                LotKind::Erc20 => {
                    assert(config.lot_token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(config.lot_amount.is_non_zero(), errors::ZERO_LOT);
                    assert(extras.lot_token_id.is_zero(), errors::BAD_LOT);
                },
                LotKind::Erc721 => {
                    assert(config.lot_token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(config.lot_amount == 1, errors::BAD_LOT);
                },
                LotKind::OffChain => {
                    assert(config.lot_token.is_zero(), errors::BAD_LOT);
                    assert(config.lot_amount.is_zero(), errors::BAD_LOT);
                    assert(extras.lot_token_id.is_zero(), errors::BAD_LOT);
                    // Nothing on chain describes the item, so the text must.
                    assert(terms.len() > 0, errors::OFFCHAIN_TERMS);
                    assert(extras.delivery_window.is_non_zero(), errors::OFFCHAIN_WINDOW);
                    assert(extras.seller_bond >= config.tick, errors::SELLER_BOND_SMALL);
                },
            }
            if extras.lot_kind != LotKind::OffChain {
                assert(
                    extras.seller_bond.is_zero() && extras.delivery_window.is_zero(),
                    errors::ONCHAIN_NO_DELIVERY,
                );
            }

            // The published text and the stored hash cannot disagree: the contract
            // computes one from the other.
            let terms_hash = if terms.len() > 0 {
                let mut buf: Array<felt252> = array![];
                terms.serialize(ref buf);
                poseidon_hash_span(buf.span())
            } else {
                config.terms_hash
            };

            let seller = get_caller_address();
            let stored = AuctionConfig { seller, terms_hash, ..config };
            // Reject a ladder whose top price would overflow u128 before anyone can bid.
            let top = cap_price(stored);
            // `abandon` pays the bond to the bidders, so an unbounded bond would let a
            // bidder's share exceed the collateral they staked — at which point the
            // auction failing is worth more to them than it succeeding. Capping it at the
            // uniform collateral keeps a share strictly below one bidder's own stake.
            assert(stored.auctioneer_bond <= top, errors::BOND_TOO_LARGE);

            let id = self.next_id.read();
            self.next_id.write(id + 1);
            self.configs.entry(id).write(stored);
            self.extras.entry(id).write(extras);
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
            match extras.lot_kind {
                LotKind::Erc20 => pull(stored.lot_token, seller, this, stored.lot_amount),
                LotKind::Erc721 => {
                    let nft = IERC721Dispatcher { contract_address: stored.lot_token };
                    // Plain `transfer_from`: no receiver hook, so this contract need not
                    // implement one, and an NFT safe-transferred here by mistake reverts.
                    nft.transfer_from(seller, this, extras.lot_token_id);
                    // The selectors collide with ERC-20's, so an ERC-20 passed as a
                    // collection would "transfer" here. It has no `owner_of`.
                    assert(nft.owner_of(extras.lot_token_id) == this, errors::LOT_NOT_ESCROWED);
                },
                LotKind::OffChain => {},
            }
            pull(stored.payment_token, seller, this, stored.auctioneer_bond);
            if extras.seller_bond.is_non_zero() {
                pull(stored.payment_token, seller, this, extras.seller_bond);
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
                        terms_hash,
                    },
                );
            if extras.lot_kind != LotKind::OffChain {
                self
                    .emit(
                        LotEscrowed {
                            auction_id: id,
                            kind: extras.lot_kind,
                            token: stored.lot_token,
                            token_id: extras.lot_token_id,
                            amount: stored.lot_amount,
                        },
                    );
            }
            if terms.len() > 0 {
                self.emit(LotTerms { auction_id: id, terms });
            }
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

            let index = state.bid_count;
            // Every bid must remain settleable inside one transaction. See `ladder`.
            assert(index < ladder::MAX_BIDS, errors::BID_LIMIT);
            assert(
                (index + 1) * config.num_levels.into() <= ladder::MAX_SETTLE_WORK,
                errors::BID_LIMIT,
            );

            // Copying another bid's anchors would produce a bid nobody can disposition.
            assert(
                self.anchor_seen.entry((auction_id, up_anchor)).read() == 0, errors::DUPLICATE_BID,
            );
            assert(
                self.anchor_seen.entry((auction_id, down_anchor)).read() == 0,
                errors::DUPLICATE_BID,
            );
            self.anchor_seen.entry((auction_id, up_anchor)).write(index + 1);
            self.anchor_seen.entry((auction_id, down_anchor)).write(index + 1);

            let escrow = cap_price(config);
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

            // Pulled after every write, so a token that calls back in sees the bid
            // already recorded and cannot land a second one on the same index.
            pull(config.payment_token, get_caller_address(), get_contract_address(), escrow);

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

        fn post_reveal(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            eph_x: felt252,
            c_seed: felt252,
            c_level: felt252,
        ) {
            self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let state = self.states.entry(auction_id).read();
            assert(state.status == Status::Sealed, errors::NOT_SEALED);
            assert(
                get_block_timestamp() < state.sealed_at_time + extras.reveal_window,
                errors::REVEAL_CLOSED,
            );
            assert(bid_index < state.bid_count, errors::BAD_INDEX);

            // Append-only and permissionless. A garbage reveal posted by anyone blocks
            // nothing: only one that opens to the bid's own anchors ever counts.
            self
                .reveals
                .entry((auction_id, bid_index, reveal::record(eph_x, c_seed, c_level)))
                .write(true);
            self.emit(RevealPosted { auction_id, bid_index, eph_x, c_seed, c_level });
        }

        fn settle(
            ref self: ContractState,
            auction_id: u64,
            clearing_level: u16,
            winner_index: u32,
            proofs: Span<DispositionProof>,
        ) {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Sealed, errors::NOT_SEALED);
            assert(get_caller_address() == config.auctioneer, errors::NOT_AUCTIONEER);
            // Every reveal that can arrive has arrived. A bid revealed in time is a bid
            // the auctioneer had.
            assert(
                get_block_timestamp() >= state.sealed_at_time + extras.reveal_window,
                errors::REVEAL_OPEN,
            );
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

        fn dispute(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            r: felt252,
            c_seed: felt252,
            c_level: felt252,
        ) {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Settled, errors::NOT_SETTLED);
            assert(get_block_timestamp() < state.dispute_deadline, errors::DISPUTE_CLOSED);
            assert(bid_index < state.bid_count, errors::BAD_INDEX);

            let mut bid = self.bids.entry((auction_id, bid_index)).read();
            // Only a bid the settlement left out. The winner and every bid the
            // settlement placed were accounted for; disputing them breaks a correct
            // outcome rather than a wrong one.
            assert(bid.disposition == Disposition::Forfeit, errors::ONLY_FORFEIT);

            // The auctioneer had this bid: a reveal for it was posted in the window...
            let eph_x = match reveal::ephemeral_x(r) {
                Some(x) => x,
                None => panic_with_felt252(errors::REVEAL_BAD),
            };
            assert(
                self
                    .reveals
                    .entry((auction_id, bid_index, reveal::record(eph_x, c_seed, c_level)))
                    .read(),
                errors::REVEAL_NOT_POSTED,
            );
            // ...and it opens to a seed and level that produce both of the bid's anchors,
            // so the auctioneer could have proved any disposition it needed.
            let (seed, level_felt) =
                match reveal::open(
                    r,
                    extras.reveal_key_x,
                    extras.reveal_key_y,
                    auction_id,
                    bid_index,
                    c_seed,
                    c_level,
                ) {
                Some(opened) => opened,
                None => panic_with_felt252(errors::REVEAL_BAD),
            };
            let level: u16 = match level_felt.try_into() {
                Some(l) => l,
                None => panic_with_felt252(errors::REVEAL_BAD),
            };
            assert(level < config.num_levels, errors::REVEAL_BAD);
            assert(
                ladder::up_anchor(auction_id, bid.claim_commitment, seed, level) == bid.up_anchor
                    && ladder::down_anchor(
                        auction_id, bid.claim_commitment, seed, level, config.num_levels,
                    ) == bid
                        .down_anchor,
                errors::REVEAL_BAD,
            );
            // Leaving it out changed the result: it beat the price the settlement set,
            // or the settlement claimed nobody bid validly at all.
            assert(
                level > state.clearing_level || state.winner_index == NO_WINNER,
                errors::CHANGED_NOTHING,
            );

            state.status = Status::Cancelled;
            self.states.entry(auction_id).write(state);

            // The bond goes to the bid that was left out, collected with its own claim
            // secret — not to whoever sent this transaction. The auctioneer, who knows
            // every revealed seed, gains nothing by disputing its own settlement.
            bid.escrow += config.auctioneer_bond;
            self.bids.entry((auction_id, bid_index)).write(bid);
            self.unwind(auction_id, extras);

            self.emit(Disputed { auction_id, bid_index, bond_credited: config.auctioneer_bond });
        }

        fn finalize(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Settled, errors::NOT_SETTLED);
            assert(get_block_timestamp() >= state.dispute_deadline, errors::DISPUTE_OPEN);

            let mut proceeds: u128 = 0;
            if state.winner_index == NO_WINNER {
                // Nothing was awarded. The lot goes back; every bid keeps its escrow,
                // and the auctioneer's bond is owed back to the seller.
                state.status = Status::Cancelled;
                self.states.entry(auction_id).write(state);
                self.credit_seller(auction_id, config.auctioneer_bond);
                self.unwind(auction_id, extras);
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

                if extras.lot_kind == LotKind::OffChain {
                    // Nothing was delivered yet. The price waits on the buyer.
                    self
                        .deliveries
                        .entry(auction_id)
                        .write(
                            Delivery {
                                buyer: Zero::zero(),
                                deadline: get_block_timestamp() + extras.delivery_window,
                                outcome: DeliveryOutcome::Pending,
                                price,
                            },
                        );
                    self.credit_seller(auction_id, config.auctioneer_bond);
                } else {
                    state.proceeds_paid = true;
                    self.credit_seller(auction_id, price + config.auctioneer_bond);
                }
                self.states.entry(auction_id).write(state);
            }

            self.emit(Finalized { auction_id, proceeds });
        }

        /// Cancels a sealed auction the auctioneer abandoned.
        ///
        /// Permissionless on purpose. The people with funds trapped in it are the
        /// bidders, and requiring the auctioneer's cooperation to escape the
        /// auctioneer's absence would be no escape at all.
        ///
        /// The grace is the reveal window and then the auction's own `dispute_window`:
        /// both public at listing, so a bidder can read them before committing.
        ///
        /// Cancelling refunds every bidder in full — forfeits included, since no
        /// settlement ever established who forfeited — returns the lot, and forfeits the
        /// auctioneer's bond to the bidders if there were any.
        fn abandon(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            assert(state.status == Status::Sealed, errors::NOT_SEALED);
            assert(
                get_block_timestamp() >= state.sealed_at_time
                    + extras.reveal_window
                    + config.dispute_window,
                errors::SETTLE_GRACE_OPEN,
            );

            state.status = Status::Cancelled;
            self.states.entry(auction_id).write(state);

            if state.bid_count == 0 {
                // Nobody turned up, so nobody was harmed. The bond goes home.
                self.credit_seller(auction_id, config.auctioneer_bond);
            } else {
                // Forfeited to the bidders, claimed pro-rata through `collect`.
                //
                // Returning it to the seller was the v1 defect: the bond is pulled from
                // the seller at listing, so where one address is both seller and
                // auctioneer, abandoning cost nothing. Walking away now costs the bond,
                // whoever the seller is, and it is paid to the people who locked capital.
                self.bond_pot.entry(auction_id).write(config.auctioneer_bond);
            }
            self.unwind(auction_id, extras);

            self.emit(Abandoned { auction_id, bid_count: state.bid_count });
        }

        fn collect(
            ref self: ContractState,
            auction_id: u64,
            bid_index: u32,
            claim_secret: felt252,
            recipient: ContractAddress,
            lot_recipient: ContractAddress,
        ) -> u128 {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            let finalized = state.status == Status::Finalized;
            assert(finalized || state.status == Status::Cancelled, errors::NOT_FINAL);
            assert(bid_index < state.bid_count, errors::BAD_INDEX);

            let mut bid = self.bids.entry((auction_id, bid_index)).read();
            // A cancelled auction refunds everyone, forfeits included.
            if finalized {
                assert(bid.disposition != Disposition::Forfeit, errors::IS_FORFEIT);
            }
            let escrow = self.take(auction_id, bid_index, ref bid, claim_secret);
            // Integer division truncates, so a few wei of a forfeited bond can remain in
            // the contract. Splitting the remainder would need a designated recipient and
            // a tie-break; dust is the cheaper answer and it is nobody's to claim.
            let share = match self.bond_pot.entry(auction_id).read() {
                0 => 0_u128,
                pot => pot / state.bid_count.into(),
            };
            let amount = escrow + share;

            let wins = finalized && bid_index == state.winner_index;
            if wins {
                // `take` already refuses a second collect, and this is the only path to
                // the lot, so it cannot have been claimed.
                assert(lot_recipient.is_non_zero(), errors::ZERO_RECIPIENT);
                state.lot_claimed = true;
                self.states.entry(auction_id).write(state);
                if extras.lot_kind == LotKind::OffChain {
                    let mut delivery = self.deliveries.entry(auction_id).read();
                    delivery.buyer = lot_recipient;
                    self.deliveries.entry(auction_id).write(delivery);
                }
            }

            if amount.is_non_zero() {
                push(config.payment_token, recipient, amount);
            }
            if wins {
                match extras.lot_kind {
                    LotKind::Erc20 => push(config.lot_token, lot_recipient, config.lot_amount),
                    LotKind::Erc721 => {
                        // Safe transfer: an account passes, and a contract that cannot
                        // hold NFTs reverts rather than swallowing the lot. The winner can
                        // retry with another address; nothing was spent.
                        IERC721Dispatcher { contract_address: config.lot_token }
                            .safe_transfer_from(
                                get_contract_address(),
                                lot_recipient,
                                extras.lot_token_id,
                                array![].span(),
                            );
                    },
                    LotKind::OffChain => {},
                }
                self.emit(LotClaimed { auction_id, amount: config.lot_amount });
            }
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
            // The loser-side proof the auctioneer could not produce, served late by the
            // bidder. It exists only for a bid at or below the clearing level; above it,
            // the escrow stays in the contract.
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

            // No bond share: the pot is only ever set by `abandon`, which cancels.
            let amount = self.take(auction_id, bid_index, ref bid, claim_secret);
            push(config.payment_token, recipient, amount);
            self.emit(RefundClaimed { auction_id, bid_index, amount });
            amount
        }

        fn withdraw_seller(ref self: ContractState, auction_id: u64) -> u128 {
            let config = self.load_config(auction_id);
            let amount = self.owed.entry(auction_id).read();
            assert(amount.is_non_zero(), errors::NOTHING_OWED);
            self.owed.entry(auction_id).write(0);
            push(config.payment_token, config.seller, amount);
            self.emit(SellerPaid { auction_id, amount });
            amount
        }

        fn reclaim_lot(ref self: ContractState, auction_id: u64) {
            let config = self.load_config(auction_id);
            let extras = self.extras.entry(auction_id).read();
            assert(
                self.lot_returnable.entry(auction_id).read()
                    && !self.lot_returned.entry(auction_id).read(),
                errors::NOT_RECLAIMABLE,
            );
            self.lot_returned.entry(auction_id).write(true);
            match extras.lot_kind {
                LotKind::Erc20 => push(config.lot_token, config.seller, config.lot_amount),
                LotKind::Erc721 => IERC721Dispatcher { contract_address: config.lot_token }
                    .transfer_from(get_contract_address(), config.seller, extras.lot_token_id),
                LotKind::OffChain => {},
            }
            self.emit(LotReclaimed { auction_id });
        }

        fn confirm_delivery(ref self: ContractState, auction_id: u64) {
            let mut delivery = self.pending_delivery(auction_id);
            assert(
                delivery.buyer.is_non_zero() && get_caller_address() == delivery.buyer,
                errors::NOT_BUYER,
            );
            delivery.outcome = DeliveryOutcome::Confirmed;
            self.deliveries.entry(auction_id).write(delivery);
            self.pay_out_delivery(auction_id, delivery.price);
            self.emit(DeliveryConfirmed { auction_id });
        }

        fn reject_delivery(ref self: ContractState, auction_id: u64) {
            let mut delivery = self.pending_delivery(auction_id);
            assert(
                delivery.buyer.is_non_zero() && get_caller_address() == delivery.buyer,
                errors::NOT_BUYER,
            );
            assert(get_block_timestamp() < delivery.deadline, errors::DELIVERY_CLOSED);
            delivery.outcome = DeliveryOutcome::Rejected;
            self.deliveries.entry(auction_id).write(delivery);
            // Nothing moves, now or ever. Refunding the buyer would let a buyer who was
            // delivered reject and keep both; paying the seller would make rejection
            // meaningless. Locking both removes the profit from either side's lie.
            let extras = self.extras.entry(auction_id).read();
            self
                .emit(
                    DeliveryRejected {
                        auction_id, price_locked: delivery.price, bond_locked: extras.seller_bond,
                    },
                );
        }

        fn release_proceeds(ref self: ContractState, auction_id: u64) {
            let mut delivery = self.pending_delivery(auction_id);
            assert(get_block_timestamp() >= delivery.deadline, errors::DELIVERY_OPEN);
            delivery.outcome = DeliveryOutcome::Released;
            self.deliveries.entry(auction_id).write(delivery);
            self.pay_out_delivery(auction_id, delivery.price);
            self.emit(ProceedsReleased { auction_id });
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

        fn get_extras(self: @ContractState, auction_id: u64) -> AuctionExtras {
            self.load_config(auction_id);
            self.extras.entry(auction_id).read()
        }

        fn get_delivery(self: @ContractState, auction_id: u64) -> Delivery {
            self.deliveries.entry(auction_id).read()
        }

        fn bid_index_of(self: @ContractState, auction_id: u64, anchor: felt252) -> u32 {
            match self.anchor_seen.entry((auction_id, anchor)).read() {
                0 => NO_BID,
                n => n - 1,
            }
        }

        fn reveal_posted(
            self: @ContractState,
            auction_id: u64,
            bid_index: u32,
            eph_x: felt252,
            c_seed: felt252,
            c_level: felt252,
        ) -> bool {
            self
                .reveals
                .entry((auction_id, bid_index, reveal::record(eph_x, c_seed, c_level)))
                .read()
        }

        fn seller_owed(self: @ContractState, auction_id: u64) -> u128 {
            self.owed.entry(auction_id).read()
        }

        fn lot_reclaimable(self: @ContractState, auction_id: u64) -> bool {
            self.lot_returnable.entry(auction_id).read()
                && !self.lot_returned.entry(auction_id).read()
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

        fn credit_seller(ref self: ContractState, auction_id: u64, amount: u128) {
            if amount.is_non_zero() {
                let owed = self.owed.entry(auction_id).read();
                self.owed.entry(auction_id).write(owed + amount);
            }
        }

        /// Everything a cancellation gives back to the seller: the lot becomes
        /// reclaimable and an off-chain seller bond is owed. Records only; moves nothing.
        fn unwind(ref self: ContractState, auction_id: u64, extras: AuctionExtras) {
            if extras.lot_kind != LotKind::OffChain {
                self.lot_returnable.entry(auction_id).write(true);
            }
            self.credit_seller(auction_id, extras.seller_bond);
        }

        fn pending_delivery(self: @ContractState, auction_id: u64) -> Delivery {
            self.load_config(auction_id);
            let delivery = self.deliveries.entry(auction_id).read();
            assert(delivery.outcome == DeliveryOutcome::Pending, errors::NOT_PENDING);
            delivery
        }

        fn pay_out_delivery(ref self: ContractState, auction_id: u64, price: u128) {
            let extras = self.extras.entry(auction_id).read();
            let mut state = self.states.entry(auction_id).read();
            state.proceeds_paid = true;
            self.states.entry(auction_id).write(state);
            self.credit_seller(auction_id, price + extras.seller_bond);
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

    /// Pulls exactly `amount`, or nothing. A token that delivers less than it was asked
    /// for (a fee on transfer) would let one auction's shortfall be paid out of another
    /// auction's escrow in the same token, so it is refused at the door.
    fn pull(token: ContractAddress, from: ContractAddress, to: ContractAddress, amount: u128) {
        let erc20 = IERC20Dispatcher { contract_address: token };
        let before = erc20.balance_of(to);
        let ok = erc20.transfer_from(sender: from, recipient: to, amount: amount.into());
        assert(ok, errors::TRANSFER_FAILED);
        let after = erc20.balance_of(to);
        assert(after >= before && after - before == amount.into(), errors::TRANSFER_SHORTFALL);
    }

    fn push(token: ContractAddress, to: ContractAddress, amount: u128) {
        let ok = IERC20Dispatcher { contract_address: token }
            .transfer(recipient: to, amount: amount.into());
        assert(ok, errors::TRANSFER_FAILED);
    }
}
