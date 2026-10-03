use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use auction::erc721::IERC721Dispatcher;
use auction::interface::{ISealedBidAuctionDispatcher, ISealedBidAuctionDispatcherTrait};
use auction::mocks::{
    IHostileDispatcher, IMockERC721AdminDispatcher, IMockERC721AdminDispatcherTrait,
};
use auction::types::{
    AuctionConfig, AuctionExtras, AuctionKind, DispositionProof, LotKind, ProofKind,
};
use auction::{ladder, reveal};
use core::ec::{EcPointTrait, stark_curve};
use core::num::traits::Zero;
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
/// Seconds after the seal during which reveals may be posted.
pub const REVEAL: u64 = 50;
/// When the reveal window closes and `settle` becomes possible.
pub const SETTLE_AT: u64 = DEADLINE + REVEAL;
/// The auctioneer's per-auction secret key, and so its public reveal key.
pub const AUCTIONEER_SK: felt252 = 'AUCTIONEER_SK';
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

/// The public half of `AUCTIONEER_SK`.
pub fn reveal_key() -> (felt252, felt252) {
    let g = EcPointTrait::new_nz(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap();
    let p: core::ec::EcPoint = g.into();
    let pk: core::ec::NonZeroEcPoint = p.mul(AUCTIONEER_SK).try_into().unwrap();
    pk.coordinates()
}

/// v2's listing extras for an ERC-20 lot: the reveal key and window, nothing else.
pub fn erc20_extras() -> AuctionExtras {
    let (x, y) = reveal_key();
    AuctionExtras {
        lot_kind: LotKind::Erc20,
        lot_token_id: 0,
        reveal_key_x: x,
        reveal_key_y: y,
        reveal_window: REVEAL,
        delivery_window: 0,
        seller_bond: 0,
    }
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

pub fn deploy_token(recipient: ContractAddress, supply: u256) -> IERC20Dispatcher {
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

fn setup_full(kind: AuctionKind, num_levels: u16, bond: u128, who: ContractAddress) -> Env {
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
    let id = auction.create_auction(config, erc20_extras(), "");
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

/// Places a bid with **raw anchors** — felts that correspond to no level on the ladder.
///
/// `place_bid` takes two anchors and never sees a level, so this is a thing a bidder can
/// really do. It exists to test what happens to the escrow afterwards, which is a
/// question about where money ends up rather than about the cryptography.
pub fn place_raw(env: Env, commitment: felt252, up: felt252, down: felt252) -> u32 {
    let collateral = env.auction.collateral(env.id);
    fund(env.pay, pool(), collateral);
    approve_as(env.pay, pool(), env.auction.contract_address, collateral);

    start_cheat_caller_address(env.auction.contract_address, pool());
    let index = env.auction.place_bid(env.id, commitment, up, down);
    stop_cheat_caller_address(env.auction.contract_address);
    index
}

pub fn seal(env: Env) {
    start_cheat_block_timestamp_global(DEADLINE);
    env.auction.seal(env.id);
}

/// Settles once the reveal window has closed, which is the earliest the contract allows.
pub fn settle(env: Env, clearing: u16, winner: u32, proofs: Array<DispositionProof>) {
    start_cheat_block_timestamp_global(SETTLE_AT);
    start_cheat_caller_address(env.auction.contract_address, auctioneer());
    env.auction.settle(env.id, clearing, winner, proofs.span());
    stop_cheat_caller_address(env.auction.contract_address);
}

pub fn finalize(env: Env) {
    start_cheat_block_timestamp_global(SETTLE_AT + WINDOW + 1);
    env.auction.finalize(env.id);
}

/// The moment `abandon` becomes possible: the reveal window, then the settle grace.
pub const ABANDON_AT: u64 = DEADLINE + REVEAL + WINDOW;

/// Everything a bid is owed, in one call, paid to `payout()`.
pub fn collect(env: Env, index: u32, secret: felt252) -> u128 {
    env.auction.collect(env.id, index, secret, payout(), payout())
}

/// Pays out what the seller is owed and returns their payment-token balance after.
pub fn seller_paid(env: Env) -> u128 {
    if env.auction.seller_owed(env.id) != 0 {
        env.auction.withdraw_seller(env.id);
    }
    balance(env.pay, seller())
}

/// Returns an unsold lot to the seller and returns their lot balance after.
pub fn seller_lot(env: Env) -> u128 {
    if env.auction.lot_reclaimable(env.id) {
        env.auction.reclaim_lot(env.id);
    }
    balance(env.lot, seller())
}

// ---- reveals --------------------------------------------------------------------

/// What a bidder posts: `(eph_x, c_seed, c_level)`.
#[derive(Copy, Drop)]
pub struct Posted {
    pub eph_x: felt252,
    pub c_seed: felt252,
    pub c_level: felt252,
}

/// The bidder's ephemeral scalar, derived from its seed as the client does.
pub fn eph_r(env: Env, kit: Kit) -> felt252 {
    reveal::ephemeral_scalar(kit.seed, env.id, kit.index)
}

/// Encrypts a bid's reveal to the auctioneer's key, without posting it.
pub fn sealed_reveal(env: Env, kit: Kit) -> Posted {
    let (x, y) = reveal_key();
    let (eph_x, c_seed, c_level) = reveal::encrypt(
        eph_r(env, kit), x, y, env.id, kit.index, kit.seed, kit.level,
    );
    Posted { eph_x, c_seed, c_level }
}

/// Posts a bid's reveal on chain, inside the window. Anyone may send it.
pub fn post(env: Env, kit: Kit) -> Posted {
    let p = sealed_reveal(env, kit);
    env.auction.post_reveal(env.id, kit.index, p.eph_x, p.c_seed, p.c_level);
    p
}

/// Opens the bid's posted reveal in a dispute.
pub fn dispute_with(env: Env, kit: Kit, p: Posted) {
    env.auction.dispute(env.id, kit.index, eph_r(env, kit), p.c_seed, p.c_level);
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

// ---- other lots and other tokens --------------------------------------------------

pub const NFT_ID: u256 = 77;
pub const SELLER_BOND: u128 = 40;
pub const DELIVERY: u64 = 500;

pub fn deploy_auction() -> ISealedBidAuctionDispatcher {
    let class = declare("SealedBidAuction").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![]).unwrap();
    ISealedBidAuctionDispatcher { contract_address: addr }
}

/// A token whose fee, freeze and blocklist the test controls.
pub fn deploy_hostile() -> IERC20Dispatcher {
    let class = declare("HostileERC20").unwrap().contract_class();
    let mut cd: Array<felt252> = array![];
    Serde::serialize(@bank(), ref cd);
    Serde::serialize(@1_000_000_u256, ref cd);
    let (addr, _) = class.deploy(@cd).unwrap();
    IERC20Dispatcher { contract_address: addr }
}

pub fn deploy_nft() -> ContractAddress {
    let (addr, _) = declare("MockERC721").unwrap().contract_class().deploy(@array![]).unwrap();
    addr
}

pub fn nft_admin(addr: ContractAddress) -> IMockERC721AdminDispatcher {
    IMockERC721AdminDispatcher { contract_address: addr }
}

pub fn nft(addr: ContractAddress) -> IERC721Dispatcher {
    IERC721Dispatcher { contract_address: addr }
}

pub fn hostile(token: IERC20Dispatcher) -> IHostileDispatcher {
    IHostileDispatcher { contract_address: token.contract_address }
}

pub fn config_for(
    pay: ContractAddress, lot_token: ContractAddress, lot_amount: u128, num_levels: u16,
) -> AuctionConfig {
    AuctionConfig {
        seller: seller(),
        auctioneer: auctioneer(),
        payment_token: pay,
        lot_token,
        lot_amount,
        kind: AuctionKind::Vickrey,
        reserve_price: RESERVE,
        tick: TICK,
        num_levels,
        bid_deadline: DEADLINE,
        dispute_window: WINDOW,
        auctioneer_bond: BOND,
        terms_hash: 'ONE_RARE_THING',
    }
}

/// Lists from the seller, funding and approving the payment-token side (bond and seller
/// bond). The lot side must already be funded and approved by the caller.
pub fn list(
    auction: ISealedBidAuctionDispatcher,
    pay: IERC20Dispatcher,
    config: AuctionConfig,
    extras: AuctionExtras,
    terms: ByteArray,
) -> u64 {
    let needed = BOND + extras.seller_bond;
    fund(pay, seller(), needed);
    approve_as(pay, seller(), auction.contract_address, needed);
    start_cheat_caller_address(auction.contract_address, seller());
    let id = auction.create_auction(config, extras, terms);
    stop_cheat_caller_address(auction.contract_address);
    id
}

/// An auction selling `NFT_ID` of a fresh collection. `env.lot` carries the collection's
/// address; drive it through `nft(...)`.
pub fn setup_nft() -> Env {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let collection = deploy_nft();
    let auction = deploy_auction();
    nft_admin(collection).mint(seller(), NFT_ID);
    start_cheat_caller_address(collection, seller());
    nft_admin(collection).approve(auction.contract_address, NFT_ID);
    stop_cheat_caller_address(collection);

    let extras = AuctionExtras {
        lot_kind: LotKind::Erc721, lot_token_id: NFT_ID, ..erc20_extras(),
    };
    let id = list(
        auction, pay, config_for(pay.contract_address, collection, 1, LEVELS), extras, "",
    );
    Env { auction, pay, lot: IERC20Dispatcher { contract_address: collection }, id }
}

pub fn offchain_terms() -> ByteArray {
    "One signed first edition. Shipped tracked within 7 days of the auction closing."
}

pub fn offchain_extras() -> AuctionExtras {
    AuctionExtras {
        lot_kind: LotKind::OffChain,
        delivery_window: DELIVERY,
        seller_bond: SELLER_BOND,
        ..erc20_extras(),
    }
}

/// An auction selling something with no on-chain asset.
pub fn setup_offchain() -> Env {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let auction = deploy_auction();
    let config = config_for(pay.contract_address, Zero::zero(), 0, LEVELS);
    let id = list(auction, pay, config, offchain_extras(), offchain_terms());
    Env { auction, pay, lot: IERC20Dispatcher { contract_address: Zero::zero() }, id }
}

/// An ERC-20 lot auction whose payment token is hostile.
pub fn setup_hostile_pay() -> Env {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_hostile();
    let lot = deploy_token(bank(), 1_000_u256);
    let auction = deploy_auction();
    fund(lot, seller(), LOT);
    approve_as(lot, seller(), auction.contract_address, LOT);
    let config = config_for(pay.contract_address, lot.contract_address, LOT, LEVELS);
    let id = list(auction, pay, config, erc20_extras(), "");
    Env { auction, pay, lot, id }
}

/// An ERC-20 lot auction whose lot token is hostile.
pub fn setup_hostile_lot() -> Env {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let lot = deploy_hostile();
    let auction = deploy_auction();
    fund(lot, seller(), LOT);
    approve_as(lot, seller(), auction.contract_address, LOT);
    let config = config_for(pay.contract_address, lot.contract_address, LOT, LEVELS);
    let id = list(auction, pay, config, erc20_extras(), "");
    Env { auction, pay, lot, id }
}
