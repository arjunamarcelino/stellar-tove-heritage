#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, IntoVal, Map, String, Symbol, Val, Vec,
};
use tove_emergency_freeze::EmergencyFreeze;
use tove_fraction_token::{FractionToken, FractionTokenClient, TokenInit};
use tove_kyc_allowlist::{KycAllowlist, KycAllowlistClient};

use crate::storage::DataKey;
use crate::{Error, OfferingEscrow, OfferingEscrowClient, Status};

// Default mint-invariant fixture: total_supply 1000 = 850 allocatable +
// artist_retention 100 + treasury_retention 50 + leftover 0.
const TOTAL_SUPPLY: i128 = 1000;
const ARTIST_RETENTION: i128 = 100;
const TREASURY_RETENTION: i128 = 50;
const LEFTOVER: i128 = 0;

#[allow(dead_code)] // some fields are read only by a subset of tests / helpers
struct Setup<'a> {
    env: Env,
    escrow_id: Address,
    escrow: OfferingEscrowClient<'a>,
    token_id: Address,
    token: FractionTokenClient<'a>,
    usdc: Address,
    admin: Address,
    artist: Address,
    artist_payout: Address,
    treasury: Address,
    kyc: KycAllowlistClient<'a>,
    total_supply: i128,
    artist_retention: i128,
    treasury_retention: i128,
    leftover: i128,
}

fn setup<'a>() -> Setup<'a> {
    setup_params(TOTAL_SUPPLY, ARTIST_RETENTION, TREASURY_RETENTION, LEFTOVER)
}

/// Full harness: real USDC SAC, real KYC/freeze, escrow registered FIRST (so
/// its address is the token's `minter`), then a real FractionToken with
/// `minter = escrow`, then `bind_token`. Auths are mocked for the whole build.
fn setup_params<'a>(
    total_supply: i128,
    artist_retention: i128,
    treasury_retention: i128,
    leftover: i128,
) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let artist_payout = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gating_admin = Address::generate(&env);
    let marketplace_settler = Address::generate(&env);

    // Real USDC SAC.
    let usdc_admin = Address::generate(&env);
    let usdc = env
        .register_stellar_asset_contract_v2(usdc_admin.clone())
        .address();

    // Real gating contracts (the token funnels every mint recipient through
    // them cross-contract).
    let kyc_id = env.register(KycAllowlist, (gating_admin.clone(),));
    let freeze_id = env.register(EmergencyFreeze, (gating_admin.clone(),));
    let kyc = KycAllowlistClient::new(&env, &kyc_id);

    // Escrow FIRST — its address is the token's minter.
    let escrow_id = env.register(
        OfferingEscrow,
        (
            usdc.clone(),
            total_supply,
            artist.clone(),
            artist_retention,
            treasury.clone(),
            treasury_retention,
            leftover,
            artist_payout.clone(),
            admin.clone(),
        ),
    );
    let escrow = OfferingEscrowClient::new(&env, &escrow_id);

    // Token with minter = escrow, lockups 0.
    let init = TokenInit {
        artwork_id: BytesN::from_array(&env, &[9u8; 32]),
        name: String::from_str(&env, "Tove Offering Fraction"),
        symbol: String::from_str(&env, "TOVEO"),
        proxy_admin: admin.clone(),
        artist: artist.clone(),
        artist_payout: artist_payout.clone(),
        treasury: treasury.clone(),
        artist_retention,
        artist_lockup_until: 0,
        treasury_retention,
        treasury_lockup_until: 0,
        kyc_allowlist: kyc_id.clone(),
        freeze_set: freeze_id.clone(),
        marketplace_settler,
        minter: escrow_id.clone(),
        usdc: usdc.clone(),
        impl_wasm_hash: BytesN::from_array(&env, &[1u8; 32]),
    };
    let token_id = env.register(FractionToken, (init,));
    let token = FractionTokenClient::new(&env, &token_id);

    escrow.bind_token(&token_id);

    Setup {
        env,
        escrow_id,
        escrow,
        token_id,
        token,
        usdc,
        admin,
        artist,
        artist_payout,
        treasury,
        kyc,
        total_supply,
        artist_retention,
        treasury_retention,
        leftover,
    }
}

fn fund(s: &Setup, who: &Address, amount: i128) {
    StellarAssetClient::new(&s.env, &s.usdc).mint(who, &amount);
}

fn usdc_bal(s: &Setup, who: &Address) -> i128 {
    TokenClient::new(&s.env, &s.usdc).balance(who)
}

fn frac_bal(s: &Setup, who: &Address) -> i128 {
    s.token.balance(who)
}

fn allow(s: &Setup, addr: &Address) {
    s.kyc.add(addr);
}

fn key(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

/// A funded bidder that submits `(price, count)` and returns `(addr, bid_id)`.
fn funded_bid(s: &Setup, price: i128, count: i128, k: u8) -> (Address, u32) {
    let bidder = Address::generate(&s.env);
    fund(s, &bidder, price * count);
    let id = s.escrow.submit_bid(&bidder, &price, &count, &key(&s.env, k));
    (bidder, id)
}

// ── M1: constructor parameter validation ──────────────────────────────────────

/// Register only the escrow with the given economic params (all Address slots
/// share one dummy — the constructor validates numbers before touching them).
fn register_escrow_params(env: &Env, total_supply: i128, ar: i128, tr: i128, leftover: i128) {
    let a = Address::generate(env);
    env.register(
        OfferingEscrow,
        (
            a.clone(),
            total_supply,
            a.clone(),
            ar,
            a.clone(),
            tr,
            leftover,
            a.clone(),
            a.clone(),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn constructor_rejects_negative_treasury_retention() {
    // A negative retention would satisfy the settle-time sum invariant while the
    // mint loop skips it — over-minting. Rejected at the source.
    let env = Env::default();
    register_escrow_params(&env, 1000, 100, -1, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn constructor_rejects_non_positive_total_supply() {
    let env = Env::default();
    register_escrow_params(&env, 0, 0, 0, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn constructor_rejects_retentions_exceeding_supply() {
    // 60 + 50 + 0 = 110 > 100: no valid allocation could ever settle.
    let env = Env::default();
    register_escrow_params(&env, 100, 60, 50, 0);
}

#[test]
fn constructor_accepts_retentions_equal_to_supply() {
    // Boundary: fully-retained offering (sum == total_supply, no winning bids)
    // is legitimate and must NOT be rejected.
    let env = Env::default();
    register_escrow_params(&env, 100, 60, 40, 0);
}

// ── U1: bidding + state machine ───────────────────────────────────────────────

#[test]
fn ae3_submit_bid_escrows_and_records_then_duplicate_key_reverts() {
    // AE3 / R1: valid submit moves price*count USDC into the escrow and records
    // the bid; the SAME idempotency key again reverts DuplicateBid.
    let s = setup();
    let bidder = Address::generate(&s.env);
    fund(&s, &bidder, 5000);

    let id = s.escrow.submit_bid(&bidder, &10, &500, &key(&s.env, 1));
    assert_eq!(id, 1);

    // USDC moved bidder → escrow; running total tracked.
    assert_eq!(usdc_bal(&s, &bidder), 0);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 5000);
    assert_eq!(s.escrow.escrowed_total(), 5000);
    assert_eq!(s.escrow.bid_count(), 1);

    let bid = s.escrow.bid(&1).unwrap();
    assert_eq!(bid.bidder, bidder);
    assert_eq!(bid.price, 10);
    assert_eq!(bid.count, 500);
    assert_eq!(bid.escrow, 5000);
    assert!(bid.active);

    // Same key again → DuplicateBid (fund enough so only the key gate fires).
    fund(&s, &bidder, 5000);
    let res = s
        .escrow
        .try_submit_bid(&bidder, &10, &500, &key(&s.env, 1));
    assert_eq!(res, Err(Ok(Error::DuplicateBid)));
}

#[test]
fn submit_bid_when_closed_reverts_offering_not_open() {
    let s = setup();
    s.escrow.close_offering();
    let bidder = Address::generate(&s.env);
    fund(&s, &bidder, 5000);
    let res = s
        .escrow
        .try_submit_bid(&bidder, &10, &500, &key(&s.env, 1));
    assert_eq!(res, Err(Ok(Error::OfferingNotOpen)));
}

#[test]
fn submit_bid_zero_price_or_count_reverts_invalid_bid() {
    let s = setup();
    let bidder = Address::generate(&s.env);
    fund(&s, &bidder, 5000);
    assert_eq!(
        s.escrow.try_submit_bid(&bidder, &0, &500, &key(&s.env, 1)),
        Err(Ok(Error::InvalidBid))
    );
    assert_eq!(
        s.escrow.try_submit_bid(&bidder, &10, &0, &key(&s.env, 2)),
        Err(Ok(Error::InvalidBid))
    );
}

#[test]
fn ae5_cancel_bid_refunds_and_lowers_escrow_total() {
    // AE5 / R2: cancel_bid while Open refunds the full escrow and the running
    // total drops.
    let s = setup();
    let (bidder, id) = funded_bid(&s, 10, 500, 1);
    assert_eq!(usdc_bal(&s, &bidder), 0);
    assert_eq!(s.escrow.escrowed_total(), 5000);

    s.escrow.cancel_bid(&bidder, &id);

    assert_eq!(usdc_bal(&s, &bidder), 5000);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 0);
    assert_eq!(s.escrow.escrowed_total(), 0);
    assert!(!s.escrow.bid(&id).unwrap().active);
}

#[test]
fn cancel_bid_after_closed_reverts_offering_not_open() {
    let s = setup();
    let (bidder, id) = funded_bid(&s, 10, 500, 1);
    s.escrow.close_offering();
    assert_eq!(
        s.escrow.try_cancel_bid(&bidder, &id),
        Err(Ok(Error::OfferingNotOpen))
    );
}

#[test]
fn cancel_other_bid_reverts_not_bid_owner() {
    let s = setup();
    let (_bidder, id) = funded_bid(&s, 10, 500, 1);
    let intruder = Address::generate(&s.env);
    assert_eq!(
        s.escrow.try_cancel_bid(&intruder, &id),
        Err(Ok(Error::NotBidOwner))
    );
}

#[test]
fn cancel_inactive_bid_reverts_bid_inactive() {
    let s = setup();
    let (bidder, id) = funded_bid(&s, 10, 500, 1);
    s.escrow.cancel_bid(&bidder, &id);
    assert_eq!(
        s.escrow.try_cancel_bid(&bidder, &id),
        Err(Ok(Error::BidInactive))
    );
}

#[test]
fn cancel_unknown_bid_reverts_bid_not_found() {
    let s = setup();
    let who = Address::generate(&s.env);
    assert_eq!(
        s.escrow.try_cancel_bid(&who, &42),
        Err(Ok(Error::BidNotFound))
    );
}

#[test]
fn close_offering_requires_admin_auth() {
    let s = setup();
    s.env.set_auths(&[]); // enforcing: nobody authorizes
    let res = s.escrow.try_close_offering();
    assert!(matches!(res, Err(Err(_))));
    // still Open — nothing changed.
    s.env.mock_all_auths();
    assert_eq!(s.escrow.status(), Status::Open);
}

#[test]
fn cancel_offering_pre_bid_transitions_to_cancelled() {
    let s = setup();
    s.escrow.cancel_offering();
    assert_eq!(s.escrow.status(), Status::Cancelled);
}

#[test]
fn cancel_offering_with_active_bid_reverts_has_bids() {
    let s = setup();
    funded_bid(&s, 10, 500, 1);
    assert_eq!(s.escrow.try_cancel_offering(), Err(Ok(Error::HasBids)));
    // After the bid is cancelled, the offering can be cancelled.
    let bid = s.escrow.bid(&1).unwrap();
    s.escrow.cancel_bid(&bid.bidder, &1);
    s.escrow.cancel_offering();
    assert_eq!(s.escrow.status(), Status::Cancelled);
}

#[test]
fn bind_token_is_one_shot() {
    let s = setup(); // already bound in setup
    let another = Address::generate(&s.env);
    assert_eq!(
        s.escrow.try_bind_token(&another),
        Err(Ok(Error::TokenAlreadyBound))
    );
}

#[test]
fn bind_token_requires_admin_auth() {
    // Fresh escrow (unbound) so the ONLY gate in play is admin auth.
    let env = Env::default();
    let admin = Address::generate(&env);
    let usdc_admin = Address::generate(&env);
    let usdc = env
        .register_stellar_asset_contract_v2(usdc_admin)
        .address();
    let escrow_id = env.register(
        OfferingEscrow,
        (
            usdc,
            TOTAL_SUPPLY,
            Address::generate(&env),
            ARTIST_RETENTION,
            Address::generate(&env),
            TREASURY_RETENTION,
            LEFTOVER,
            Address::generate(&env),
            admin,
        ),
    );
    let escrow = OfferingEscrowClient::new(&env, &escrow_id);
    let token = Address::generate(&env);
    // Enforcing mode, no auths → admin.require_auth() fails at the host layer.
    let res = escrow.try_bind_token(&token);
    assert!(matches!(res, Err(Err(_))));
}

// ── U2: settle + invariants ───────────────────────────────────────────────────

/// The AE1 three-bid fixture. bid1 full winner (500@10), bid2 partial winner
/// (350 of 400@12), bid3 loser (0 of 200@8). Clearing 10.
fn settle_fixture(s: &Setup) -> (Address, Address, Address) {
    let (b1, _) = funded_bid(s, 10, 500, 1); // full winner
    let (b2, _) = funded_bid(s, 12, 400, 2); // partial winner
    let (b3, _) = funded_bid(s, 8, 200, 3); // loser
    // Mint recipients must clear KYC: winners + artist + treasury.
    allow(s, &b1);
    allow(s, &b2);
    allow(s, &s.artist);
    allow(s, &s.treasury);
    (b1, b2, b3)
}

#[test]
fn ae1_close_and_settle_full_distribution_refunds_and_split() {
    // AE1 / R3: 3 bids → mint total_supply (winners + retention + leftover),
    // each refund exact, treasury +3% fee, artist_payout +97% net; every SAC
    // and fraction balance verified; token total_supply == total_supply; event
    // decoded.
    let s = setup();
    let (b1, b2, b3) = settle_fixture(&s);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)]; // bid3 omitted → loser
    s.escrow.close_and_settle(&10, &allocations);

    // offering.settled event, data decoded exact — asserted FIRST, before any
    // getter/balance invocation resets `events().all()` (which reflects only the
    // last contract invocation). `all()` after settle, filtered to the escrow,
    // is exactly the one offering.settled event (the mint + refund SAC legs ride
    // under the token / USDC contract ids and filter out).
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "clearing_price"), 10i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "proceeds"), 8500i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "platform_fee"), 255i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "artist_net"), 8245i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.escrow_id),
        vec![
            &s.env,
            (
                s.escrow_id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "offering").into_val(&s.env),
                    Symbol::new(&s.env, "settled").into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.escrow.status(), Status::Settled);

    // Fraction distribution: 500 + 350 + artist 100 + treasury 50 = 1000.
    assert_eq!(frac_bal(&s, &b1), 500);
    assert_eq!(frac_bal(&s, &b2), 350);
    assert_eq!(frac_bal(&s, &s.artist), 100);
    assert_eq!(frac_bal(&s, &s.treasury), 50);
    assert_eq!(s.token.total_supply(), 1000);

    // Refunds: b1 escrow 5000 paid 5000 → 0; b2 escrow 4800 paid 3500 → 1300;
    // b3 escrow 1600 paid 0 → 1600 (full).
    assert_eq!(usdc_bal(&s, &b1), 0);
    assert_eq!(usdc_bal(&s, &b2), 1300);
    assert_eq!(usdc_bal(&s, &b3), 1600);

    // proceeds 8500 → fee 255 (3%), net 8245 (97%).
    assert_eq!(usdc_bal(&s, &s.treasury), 255);
    assert_eq!(usdc_bal(&s, &s.artist_payout), 8245);
    // Escrow fully drained.
    assert_eq!(usdc_bal(&s, &s.escrow_id), 0);
    assert_eq!(s.escrow.escrowed_total(), 0);
}

#[test]
fn ae2_bad_mint_sum_reverts_invalid_allocation_with_zero_effect() {
    // AE2 / R3 atomic: Σ minted != total_supply → InvalidAllocation, no mint,
    // no USDC movement, status untouched.
    let s = setup();
    let (b1, b2, _b3) = settle_fixture(&s);
    s.escrow.close_offering();

    // 500 + 300 + 100 + 50 = 950 != 1000.
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 300i128)];
    let res = s.escrow.try_close_and_settle(&10, &allocations);
    assert_eq!(res, Err(Ok(Error::InvalidAllocation)));

    // Zero effect: nothing minted, escrow still holds every deposit, Closed.
    assert_eq!(s.token.total_supply(), 0);
    assert_eq!(frac_bal(&s, &b1), 0);
    assert_eq!(frac_bal(&s, &b2), 0);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 11400);
    assert_eq!(usdc_bal(&s, &s.artist_payout), 0);
    assert_eq!(s.escrow.status(), Status::Closed);
}

#[test]
fn ae4_non_round_proceeds_floor_fee_remainder_to_net_conserves() {
    // AE4 / R3 conservation with non-round proceeds. Offering: total_supply 20,
    // retentions 0, leftover 0 → all 20 allocatable. One winner: 20 @ price 7,
    // clearing 7 → proceeds 140 → fee 140*300/10000 = 4 (floor of 4.2),
    // net 136; 4 + 136 == 140 (remainder rides in net).
    let s = setup_params(20, 0, 0, 0);
    let bidder = Address::generate(&s.env);
    fund(&s, &bidder, 7 * 20);
    let id = s.escrow.submit_bid(&bidder, &7, &20, &key(&s.env, 1));
    allow(&s, &bidder);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> = vec![&s.env, (id, 20i128)];
    s.escrow.close_and_settle(&7, &allocations);

    assert_eq!(frac_bal(&s, &bidder), 20);
    assert_eq!(s.token.total_supply(), 20);
    assert_eq!(usdc_bal(&s, &bidder), 0); // paid exactly, no refund
    assert_eq!(usdc_bal(&s, &s.treasury), 4); // floored fee
    assert_eq!(usdc_bal(&s, &s.artist_payout), 136); // net + remainder
    assert_eq!(4 + 136, 140); // the split IS the proceeds
    assert_eq!(usdc_bal(&s, &s.escrow_id), 0);
}

#[test]
fn clearing_price_above_a_winner_bid_reverts_invalid_allocation() {
    // H1 regression: a winner must never be charged above the price they bid.
    // bid1 bid 10; clearing 11 > 10 must revert even though `refund >= 0` would
    // still hold for a partial fill — and nothing may mint or move (zero effect).
    let s = setup();
    let (b1, b2, _b3) = settle_fixture(&s);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    let res = s.escrow.try_close_and_settle(&11, &allocations);
    assert_eq!(res, Err(Ok(Error::InvalidAllocation)));

    assert_eq!(s.token.total_supply(), 0);
    assert_eq!(frac_bal(&s, &b1), 0);
    assert_eq!(frac_bal(&s, &b2), 0);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 11400); // every deposit still held
    assert_eq!(usdc_bal(&s, &s.artist_payout), 0);
    assert_eq!(s.escrow.status(), Status::Closed);
}

#[test]
fn clearing_price_zero_reverts_invalid_allocation_no_free_mint() {
    // H1 regression: clearing_price == 0 would mint the whole supply for free
    // (every bidder fully refunded, artist/treasury paid nothing). Must revert.
    let s = setup();
    let (b1, b2, _b3) = settle_fixture(&s);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    let res = s.escrow.try_close_and_settle(&0, &allocations);
    assert_eq!(res, Err(Ok(Error::InvalidAllocation)));

    assert_eq!(s.token.total_supply(), 0);
    assert_eq!(frac_bal(&s, &b1), 0);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 11400);
    assert_eq!(s.escrow.status(), Status::Closed);
}

#[test]
fn settle_with_a_missing_bid_entry_reverts_bid_not_found() {
    // M2 regression: a bid entry lost to archival/eviction must NOT be silently
    // skipped at settle (which would strand its escrowed USDC once the offering
    // flips to Settled with no refund path). Settle refuses with BidNotFound.
    let s = setup();
    let (_b1, _b2, b3) = settle_fixture(&s);
    s.escrow.close_offering();

    // Simulate the archival: remove bid #3's persistent entry from inside the
    // escrow's own storage context.
    s.env.as_contract(&s.escrow_id, || {
        s.env.storage().persistent().remove(&DataKey::Bid(3u32));
    });

    let allocations: Vec<(u32, i128)> = vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    let res = s.escrow.try_close_and_settle(&10, &allocations);
    assert_eq!(res, Err(Ok(Error::BidNotFound)));

    // Zero effect: nothing minted, every deposit still escrowed, still Closed —
    // the missing bidder's funds are recoverable (restore the entry, re-settle).
    assert_eq!(s.token.total_supply(), 0);
    assert_eq!(usdc_bal(&s, &b3), 0);
    assert_eq!(usdc_bal(&s, &s.escrow_id), 11400);
    assert_eq!(s.escrow.status(), Status::Closed);
}

#[test]
fn allocated_over_count_reverts_invalid_allocation() {
    let s = setup();
    let (_b1, _b2, _b3) = settle_fixture(&s);
    s.escrow.close_offering();
    // bid1 count is 500; allocate 600.
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 600i128), (2u32, 250i128)];
    assert_eq!(
        s.escrow.try_close_and_settle(&10, &allocations),
        Err(Ok(Error::InvalidAllocation))
    );
    assert_eq!(s.token.total_supply(), 0);
}

#[test]
fn clearing_above_price_negative_refund_reverts_invalid_allocation() {
    let s = setup();
    let (_b1, _b2, _b3) = settle_fixture(&s);
    s.escrow.close_offering();
    // clearing 11 > bid1 price 10 → bid1 refund = 5000 - 11*500 = -500 < 0.
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    assert_eq!(
        s.escrow.try_close_and_settle(&11, &allocations),
        Err(Ok(Error::InvalidAllocation))
    );
    assert_eq!(s.token.total_supply(), 0);
}

#[test]
fn settle_when_open_reverts_not_closed() {
    let s = setup();
    settle_fixture(&s); // still Open (not closed)
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    assert_eq!(
        s.escrow.try_close_and_settle(&10, &allocations),
        Err(Ok(Error::NotClosed))
    );
}

#[test]
fn double_settle_reverts_already_settled() {
    let s = setup();
    settle_fixture(&s);
    s.escrow.close_offering();
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    s.escrow.close_and_settle(&10, &allocations);
    assert_eq!(
        s.escrow.try_close_and_settle(&10, &allocations),
        Err(Ok(Error::AlreadySettled))
    );
}

#[test]
fn settle_requires_admin_auth() {
    let s = setup();
    settle_fixture(&s);
    s.escrow.close_offering();
    s.env.set_auths(&[]); // enforcing: nobody authorizes
    let allocations: Vec<(u32, i128)> =
        vec![&s.env, (1u32, 500i128), (2u32, 350i128)];
    let res = s.escrow.try_close_and_settle(&10, &allocations);
    assert!(matches!(res, Err(Err(_))));
    s.env.mock_all_auths();
    assert_eq!(s.escrow.status(), Status::Closed);
    assert_eq!(s.token.total_supply(), 0);
}

#[test]
fn winner_equals_artist_mints_allocation_plus_retention() {
    // Consistency: an address that is BOTH a winning bidder AND the artist gets
    // its allocation PLUS the artist retention (two mint entries, one address).
    // Offering: total_supply 1000, artist_retention 100, treasury_retention 50.
    // The artist bids and wins 850; artist final fraction balance = 850 + 100.
    let s = setup();
    let artist = s.artist.clone();
    fund(&s, &artist, 10 * 850);
    let id = s.escrow.submit_bid(&artist, &10, &850, &key(&s.env, 1));
    allow(&s, &artist);
    allow(&s, &s.treasury);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> = vec![&s.env, (id, 850i128)];
    s.escrow.close_and_settle(&10, &allocations);

    assert_eq!(frac_bal(&s, &artist), 850 + 100);
    assert_eq!(frac_bal(&s, &s.treasury), 50);
    assert_eq!(s.token.total_supply(), 1000);
    // proceeds = 8500 → fee 255, net 8245 (artist_payout is a DISTINCT address).
    assert_eq!(usdc_bal(&s, &s.treasury), 255);
    assert_eq!(usdc_bal(&s, &s.artist_payout), 8245);
}

#[test]
fn leftover_folds_into_artist_mint() {
    // Retention + leftover both land on the artist as one mint entry.
    // total_supply 1000 = 800 allocatable + artist_retention 100 +
    // treasury_retention 50 + leftover 50 → artist mints 150.
    let s = setup_params(1000, 100, 50, 50);
    let bidder = Address::generate(&s.env);
    fund(&s, &bidder, 10 * 800);
    let id = s.escrow.submit_bid(&bidder, &10, &800, &key(&s.env, 1));
    allow(&s, &bidder);
    allow(&s, &s.artist);
    allow(&s, &s.treasury);
    s.escrow.close_offering();

    let allocations: Vec<(u32, i128)> = vec![&s.env, (id, 800i128)];
    s.escrow.close_and_settle(&10, &allocations);

    assert_eq!(frac_bal(&s, &bidder), 800);
    assert_eq!(frac_bal(&s, &s.artist), 150); // 100 retention + 50 leftover
    assert_eq!(frac_bal(&s, &s.treasury), 50);
    assert_eq!(s.token.total_supply(), 1000);
}
