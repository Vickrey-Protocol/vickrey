//! The `privacy_invoke` helper that lets STRK20 pool funds bid in an auction.
//!
//! The pattern is the standard atomic sandwich:
//! `withdraw from pool -> helper acts -> credit an open note`.
//!
//! Bidding is the deposit leg: the pool withdraws the collateral to this contract,
//! this contract forwards it into the auction, and an empty span tells the pool there
//! is nothing to credit. Every claim leg is the reverse — pull from the auction,
//! approve the pool, return one `OpenNoteDeposit`, so **refunds, surplus and the lot
//! all land as private notes**.
//!
//! No bidder address ever crosses this boundary. The auction sees only this helper.
//!
//! The pool reaches `privacy_invoke` through
//! `INVOKE_SELECTOR = selector!("privacy_invoke")`, verified against
//! `starkware-libs/starknet-privacy` @ `36eac4ea`. That selector is callable by
//! anyone, so the caller check below is what keeps the helper from being driven
//! directly, bypassing the pool.
//!
//! DRAFT — an anonymizer contract is app-team code to review and audit. This has not
//! been audited. See README "Status".

#[starknet::contract]
pub mod AuctionAnonymizer {
    use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use auction::interface::{ISealedBidAuctionDispatcher, ISealedBidAuctionDispatcherTrait};
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::errors;
    use crate::interface::{AuctionOperation, IAuctionAnonymizer};
    use crate::privacy_objects::OpenNoteDeposit;

    /// Emitted on every leg that passes through the pool.
    ///
    /// It exists for two reasons. The submission rule requires each mainnet transaction
    /// to carry an event from a listed contract, and — more usefully — without it the
    /// contract that performs the actual STRK20 integration is invisible in its own
    /// transactions: the only trace is the auction's event, which looks identical
    /// whether the bid came through the pool or straight off a public address.
    ///
    /// Deliberately thin. `auction_id` and the operation kind are already public, and
    /// the auction emits its own event in the same transaction. What is **not** here:
    ///
    ///   - `note_id`, a pool-side handle. Emitting it would let an observer tie a note
    ///     to an auction action, which is exactly the link this helper exists to break.
    ///   - `bid_index` on `PlaceBid`. The auction assigns it and emits it itself; there
    ///     is no reason for two contracts to publish the same correlator.
    ///   - any amount. Collateral is uniform and public, so an amount would leak
    ///     nothing today — but it would start leaking the moment the uniform-cap rule
    ///     is relaxed, and an event is not something a later change can take back.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Routed: Routed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Routed {
        #[key]
        pub auction_id: u64,
        pub operation: AuctionOperation,
    }

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        auction_contract: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_contract: ContractAddress,
        auction_contract: ContractAddress,
    ) {
        self.privacy_contract.write(privacy_contract);
        self.auction_contract.write(auction_contract);
    }

    #[abi(embed_v0)]
    pub impl AuctionAnonymizerImpl of IAuctionAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: AuctionOperation,
            auction_id: u64,
            bid_index: u32,
            claim_commitment: felt252,
            up_anchor: felt252,
            down_anchor: felt252,
            claim_secret: felt252,
            witness_down: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // This helper handles funds mid-transaction, so it is pinned rather than
            // permissionless.
            let pool = self.privacy_contract.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_PRIVACY);

            self.emit(Routed { auction_id, operation });

            let auction_addr = self.auction_contract.read();
            let auction = ISealedBidAuctionDispatcher { contract_address: auction_addr };
            let config = auction.get_config(auction_id);

            match operation {
                AuctionOperation::PlaceBid => {
                    // The pool has already transferred the collateral here.
                    let collateral = auction.collateral(auction_id);
                    approve(config.payment_token, auction_addr, collateral);
                    auction.place_bid(auction_id, claim_commitment, up_anchor, down_anchor);
                    // Funds now sit in the auction contract. Credit nothing.
                    [].span()
                },
                AuctionOperation::ClaimRefund => {
                    let out = self
                        .collect(
                            config.payment_token,
                            || auction
                                .claim_refund(
                                    auction_id, bid_index, claim_secret, get_contract_address(),
                                ),
                        );
                    self.credit(pool, note_id, config.payment_token, out)
                },
                AuctionOperation::RedeemForfeit => {
                    let out = self
                        .collect(
                            config.payment_token,
                            || auction
                                .redeem_forfeit(
                                    auction_id,
                                    bid_index,
                                    claim_secret,
                                    witness_down,
                                    get_contract_address(),
                                ),
                        );
                    self.credit(pool, note_id, config.payment_token, out)
                },
                AuctionOperation::ClaimLot => {
                    let out = self
                        .collect(
                            config.lot_token,
                            || auction.claim_lot(auction_id, claim_secret, get_contract_address()),
                        );
                    self.credit(pool, note_id, config.lot_token, out)
                },
            }
        }

        fn privacy_contract(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }

        fn auction_contract(self: @ContractState) -> ContractAddress {
            self.auction_contract.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Runs a claim and measures what actually arrived. The auction's return
        /// value is deliberately ignored: the pool can only pull what is really here.
        fn collect<F, +Drop<F>, impl Call: core::ops::FnOnce<F, ()>, +Drop<Call::Output>>(
            self: @ContractState, token: ContractAddress, action: F,
        ) -> u128 {
            let erc20 = IERC20Dispatcher { contract_address: token };
            let this = get_contract_address();
            let before = erc20.balance_of(this);
            action();
            let after = erc20.balance_of(this);
            let delta = after - before;
            let out: u128 = delta.try_into().expect(errors::AMOUNT_OVERFLOW);
            assert(out.is_non_zero(), errors::ZERO_OUT_AMOUNT);
            out
        }

        /// Approves the pool to pull `amount` and tells it which note to credit.
        fn credit(
            self: @ContractState,
            pool: ContractAddress,
            note_id: felt252,
            token: ContractAddress,
            amount: u128,
        ) -> Span<OpenNoteDeposit> {
            approve(token, pool, amount);
            [OpenNoteDeposit { note_id, token, amount }].span()
        }
    }

    /// Approve, never transfer: the pool executes the pull itself.
    fn approve(token: ContractAddress, spender: ContractAddress, amount: u128) {
        let ok = IERC20Dispatcher { contract_address: token }
            .approve(spender: spender, amount: amount.into());
        assert(ok, errors::APPROVE_FAILED);
    }
}
