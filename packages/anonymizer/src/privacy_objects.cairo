//! Local declaration of the one protocol type this helper exchanges with the pool.
//!
//! Mirrors `privacy::objects::OpenNoteDeposit` from `starkware-libs/starknet-privacy`.
//! Declared here rather than pulled in as a git dependency so a clean `scarb build`
//! needs no external Cairo packages (PHASE0.md, engineering decision 1).
//!
//! **Verified byte-for-byte against `packages/privacy/src/objects.cairo` @
//! `36eac4ea88cd8c59dde1493176e16501c6e90328` (main, 2026-08-20)** — same three fields
//! in the same order, same derive set. The pool deserializes this contract's return
//! value by shape, so that ordering is load-bearing; `tests/test_layout.cairo` pins it.
//!
//! Re-check when bumping to a newer upstream revision.

use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    /// The identifier of the open note to deposit to.
    pub note_id: felt252,
    /// The ERC20 token contract to deposit.
    pub token: ContractAddress,
    /// The amount of tokens to deposit.
    pub amount: u128,
}
