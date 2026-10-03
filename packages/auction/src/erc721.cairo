//! Minimal ERC-721 surface, snake_case, as OpenZeppelin Contracts for Cairo exposes it.
//! Declared locally for the same reason as `erc20.cairo`: a clean `scarb build` needs no
//! external Cairo dependencies.
//!
//! The selectors of `transfer_from` and `balance_of` collide with ERC-20's, which is why
//! the lot is checked with `owner_of` after every pull rather than with a balance.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC721<T> {
    fn owner_of(self: @T, token_id: u256) -> ContractAddress;
    fn transfer_from(ref self: T, from: ContractAddress, to: ContractAddress, token_id: u256);
    fn safe_transfer_from(
        ref self: T,
        from: ContractAddress,
        to: ContractAddress,
        token_id: u256,
        data: Span<felt252>,
    );
}
