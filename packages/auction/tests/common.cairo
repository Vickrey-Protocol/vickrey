use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use auction::interface::{ISealedBidAuctionDispatcher, ISealedBidAuctionDispatcherTrait};
use auction::ladder;
use auction::types::{AuctionConfig, AuctionKind, DispositionProof, ProofKind};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

pub const RESERVE: u128 = 100;
pub const TICK: u128 = 10;
pub const LEVELS: u16 = 16;
pub const CAP: u128 = 250; // RESERVE + (LEVELS - 1) * TICK
pub const DEADLINE: u64 = 1000;
pub const WINDOW: u64 = 100;
pub const BOND: u128 = 50;
pub const LOT: u128 = 1;

pub fn seller() -> ContractAddress {
    'SELLER'.try_into().unwrap()
}
pub fn auctioneer() -> ContractAddress {
    'AUCTIONEER'.try_into().unwrap()
}
/// Stands in for the anonymizer: the only address the auction ever sees bidding.
pub fn pool() -> ContractAddress {
    'POOL_PROXY'.try_into().unwrap()
}
pub fn bank() -> ContractAddress {
    'BANK'.try_into().unwrap()
}
pub fn payout() -> ContractAddress {
    'PAYOUT'.try_into().unwrap()
}

#[derive(Copy, Drop)]
pub struct Env {
    pub auction: ISealedBidAuctionDispatcher,
    pub pay: IERC20Dispatcher,
    pub lot: IERC20Dispatcher,
    pub id: u64,
}

/// A bidder's private state. Never leaves the client in production.
#[derive(Copy, Drop)]
pub struct Kit {
    pub secret: felt252,
    pub seed: felt252,
    pub level: u16,
    pub commitment: felt252,
    pub index: u32,
}

fn deploy_token(recipient: ContractAddress, supply: u256) -> IERC20Dispatcher {
    deploy_token_with(recipient, supply, 18)
}

fn deploy_token_with(recipient: ContractAddress, supply: u256, dec: u8) -> IERC20Dispatcher {
    let class = declare("MockERC20").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@recipient, ref calldata);
    Serde::serialize(@supply, ref calldata);
    let name: ByteArray = "Mock Token";
    let symbol: ByteArray = "MOCK";
    Serde::serialize(@name, ref calldata);
    Serde::serialize(@symbol, ref calldata);
    Serde::serialize(@dec, ref calldata);
    let (addr, _) = class.deploy(@calldata).unwrap();
    IERC20Dispatcher { contract_address: addr }
}

pub fn fund(token: IERC20Dispatcher, to: ContractAddress, amount: u128) {
    start_cheat_caller_address(token.contract_address, bank());
    token.transfer(to, amount.into());
    stop_cheat_caller_address(token.contract_address);
}

pub fn approve_as(
    token: IERC20Dispatcher, owner: ContractAddress, spender: ContractAddress, amount: u128,
) {
    start_cheat_caller_address(token.contract_address, owner);
    token.approve(spender, amount.into());
    stop_cheat_caller_address(token.contract_address);
}

pub fn setup(kind: AuctionKind) -> Env {
    setup_with(kind, LEVELS, BOND)
}

pub fn setup_with_decimals(kind: AuctionKind, dec: u8) -> Env {
    setup_full_dec(kind, LEVELS, BOND, auctioneer(), dec)
}

pub fn setup_with_auctioneer(kind: AuctionKind, who: ContractAddress) -> Env {
    setup_full(kind, LEVELS, BOND, who)
}

pub fn setup_with(kind: AuctionKind, num_levels: u16, bond: u128) -> Env {
    setup_full(kind, num_levels, bond, auctioneer())
}

fn setup_full(
    kind: AuctionKind, num_levels: u16, bond: u128, who: ContractAddress,
) -> Env {
    setup_full_dec(kind, num_levels, bond, who, 18)
}

fn setup_full_dec(
    kind: AuctionKind, num_levels: u16, bond: u128, who: ContractAddress, dec: u8,
) -> Env {
    start_cheat_block_timestamp_global(1);

    let pay = deploy_token_with(bank(), 1_000_000_u256, dec);
    let lot = deploy_token_with(bank(), 1_000_u256, dec);

    let class = declare("SealedBidAuction").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![]).unwrap();
    let auction = ISealedBidAuctionDispatcher { contract_address: addr };

    fund(lot, seller(), LOT);
    fund(pay, seller(), bond);
    approve_as(lot, seller(), addr, LOT);
    approve_as(pay, seller(), addr, bond);

    let config = AuctionConfig {
        seller: seller(),
        auctioneer: who,
        payment_token: pay.contract_address,
        lot_token: lot.contract_address,
        lot_amount: LOT,
        kind,
        reserve_price: RESERVE,
        tick: TICK,
        num_levels,
        bid_deadline: DEADLINE,
        dispute_window: WINDOW,
        auctioneer_bond: bond,
        terms_hash: 'ONE_RARE_THING',
    };

    start_cheat_caller_address(addr, seller());
    let id = auction.create_auction(config);
    stop_cheat_caller_address(addr);

    Env { auction, pay, lot, id }
}

/// Places a bid the way the anonymizer would: collateral in, no bidder address.
pub fn place(env: Env, secret: felt252, seed: felt252, level: u16) -> Kit {
    let commitment = ladder::claim_commitment_of(secret);
    let num_levels = env.auction.get_config(env.id).num_levels;
    let up = ladder::up_anchor(env.id, commitment, seed, level);
    let down = ladder::down_anchor(env.id, commitment, seed, level, num_levels);
    let collateral = env.auction.collateral(env.id);

    fund(env.pay, pool(), collateral);
    approve_as(env.pay, pool(), env.auction.contract_address, collateral);

    start_cheat_caller_address(env.auction.contract_address, pool());
    let index = env.auction.place_bid(env.id, commitment, up, down);
    stop_cheat_caller_address(env.auction.contract_address);

    Kit { secret, seed, level, commitment, index }
}

pub fn seal(env: Env) {
    start_cheat_block_timestamp_global(DEADLINE);
    env.auction.seal(env.id);
}

pub fn settle(env: Env, clearing: u16, winner: u32, proofs: Array<DispositionProof>) {
    start_cheat_caller_address(env.auction.contract_address, auctioneer());
    env.auction.settle(env.id, clearing, winner, proofs.span());
    stop_cheat_caller_address(env.auction.contract_address);
}

pub fn finalize(env: Env) {
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.finalize(env.id);
}

// ---- settlement proof construction (the auctioneer's job, post-seal) ------------

pub fn proof_above(env: Env, kit: Kit, clearing: u16) -> DispositionProof {
    DispositionProof {
        kind: ProofKind::AtOrAbove,
        witness_up: ladder::witness_at_or_above(
            env.id, kit.commitment, kit.seed, kit.level, clearing,
        ),
        witness_down: 0,
    }
}

pub fn proof_exactly(env: Env, kit: Kit, clearing: u16) -> DispositionProof {
    DispositionProof {
        kind: ProofKind::Exactly,
        witness_up: ladder::witness_at_or_above(
            env.id, kit.commitment, kit.seed, kit.level, clearing,
        ),
        witness_down: ladder::witness_at_or_below(
            env.id, kit.commitment, kit.seed, kit.level, clearing,
        ),
    }
}

pub fn proof_below(env: Env, kit: Kit, clearing: u16) -> DispositionProof {
    DispositionProof {
        kind: ProofKind::AtOrBelow,
        witness_up: 0,
        witness_down: ladder::witness_at_or_below(
            env.id, kit.commitment, kit.seed, kit.level, clearing,
        ),
    }
}

pub fn proof_forfeit() -> DispositionProof {
    DispositionProof { kind: ProofKind::Forfeit, witness_up: 0, witness_down: 0 }
}

pub fn balance(token: IERC20Dispatcher, who: ContractAddress) -> u128 {
    token.balance_of(who).try_into().unwrap()
}
