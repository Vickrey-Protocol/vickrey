//! Minimal ERC-20 surface. Declared locally so a clean `scarb build` needs no
//! external Cairo dependencies (PHASE0.md, engineering decision 1). Mainnet STRK,
//! ETH and USDC all expose these snake_case entry points.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<T> {
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
}
