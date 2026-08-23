//! Test doubles. Compiled into the package so `snforge` can declare them.
//! Not intended for deployment.

#[starknet::contract]
pub mod MockERC20 {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use crate::erc20::IERC20;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        name: ByteArray,
        symbol: ByteArray,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        recipient: ContractAddress,
        supply: u256,
        name: ByteArray,
        symbol: ByteArray,
    ) {
        self.balances.entry(recipient).write(supply);
        self.name.write(name);
        self.symbol.write(symbol);
    }

    /// SNIP-2 metadata. Without a symbol every amount in a UI reads "1 tokens", which
    /// is exactly the sort of placeholder that makes a demo look unfinished.
    #[abi(embed_v0)]
    impl MetadataImpl of crate::erc20::IERC20Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }
        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }
        fn decimals(self: @ContractState) -> u8 {
            18
        }
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of IERC20<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            self.move_funds(get_caller_address(), recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            if sender != spender {
                let allowed = self.allowances.entry((sender, spender)).read();
                assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
                self.allowances.entry((sender, spender)).write(allowed - amount);
            }
            self.move_funds(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn move_funds(
            ref self: ContractState, from: ContractAddress, to: ContractAddress, amount: u256,
        ) {
            assert(to.is_non_zero(), 'TRANSFER_TO_ZERO');
            let balance = self.balances.entry(from).read();
            assert(balance >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.entry(from).write(balance - amount);
            self.balances.entry(to).write(self.balances.entry(to).read() + amount);
        }
    }
}

/// Faucet so tests can hand tokens to arbitrary addresses without an owner dance.
#[starknet::interface]
pub trait IMintable<T> {
    fn mint(ref self: T, to: starknet::ContractAddress, amount: u256);
}
