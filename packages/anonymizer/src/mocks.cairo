//! A stand-in for the STRK20 pool, exercising the `privacy_invoke` sandwich the way
//! the real pool does: withdraw to the helper, invoke it, then pull what it approved.
//! Test double, not for deployment.

use crate::privacy_objects::OpenNoteDeposit;

#[starknet::interface]
pub trait IMockPrivacyPool<T> {
    /// The deposit leg: fund the helper, invoke, and expect nothing back to credit.
    fn drive_bid(
        ref self: T,
        helper: starknet::ContractAddress,
        token: starknet::ContractAddress,
        collateral: u128,
        auction_id: u64,
        claim_commitment: felt252,
        up_anchor: felt252,
        down_anchor: felt252,
    );
    /// A claim leg: invoke, then pull the approved output as the pool would.
    fn drive_claim(
        ref self: T,
        helper: starknet::ContractAddress,
        operation: crate::interface::AuctionOperation,
        auction_id: u64,
        bid_index: u32,
        claim_secret: felt252,
        witness_down: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod MockPrivacyPool {
    use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::{ContractAddress, get_contract_address};
    use crate::interface::{
        AuctionOperation, IAuctionAnonymizerDispatcher, IAuctionAnonymizerDispatcherTrait,
    };
    use crate::privacy_objects::OpenNoteDeposit;
    use super::IMockPrivacyPool;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockPrivacyPoolImpl of IMockPrivacyPool<ContractState> {
        fn drive_bid(
            ref self: ContractState,
            helper: ContractAddress,
            token: ContractAddress,
            collateral: u128,
            auction_id: u64,
            claim_commitment: felt252,
            up_anchor: felt252,
            down_anchor: felt252,
        ) {
            // Withdraw: a plain public transfer from the pool to the helper.
            IERC20Dispatcher { contract_address: token }.transfer(helper, collateral.into());

            let deposits = IAuctionAnonymizerDispatcher { contract_address: helper }
                .privacy_invoke(
                    AuctionOperation::PlaceBid,
                    auction_id,
                    0,
                    claim_commitment,
                    up_anchor,
                    down_anchor,
                    0,
                    0,
                    0,
                );
            assert(deposits.len() == 0, 'BID_MUST_CREDIT_NOTHING');
        }

        fn drive_claim(
            ref self: ContractState,
            helper: ContractAddress,
            operation: AuctionOperation,
            auction_id: u64,
            bid_index: u32,
            claim_secret: felt252,
            witness_down: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let deposits = IAuctionAnonymizerDispatcher { contract_address: helper }
                .privacy_invoke(
                    operation, auction_id, bid_index, 0, 0, 0, claim_secret, witness_down, note_id,
                );

            // Apply the deposits: the pool pulls what the helper approved.
            let mut i = 0;
            while i < deposits.len() {
                let d = *deposits.at(i);
                let ok = IERC20Dispatcher { contract_address: d.token }
                    .transfer_from(helper, get_contract_address(), d.amount.into());
                assert(ok, 'POOL_PULL_FAILED');
                i += 1;
            }
            deposits
        }
    }
}
