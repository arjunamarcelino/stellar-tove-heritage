#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, String,
};
use tove_emergency_freeze::EmergencyFreeze;
use tove_fraction_token::{FractionToken, FractionTokenClient, TokenInit};
use tove_kyc_allowlist::{KycAllowlist, KycAllowlistClient};

use crate::storage::DataKey;
use crate::{Error, MarketplaceSettler, MarketplaceSettlerClient};

// ── Mock factory: token_of resolution only (the real fraction-factory is
//    exercised end-to-end in integration-tests/tests/marketplace_settler.rs).
//    The settle PATH below uses a REAL FractionToken — no mocks there. ──────────
#[contract]
struct MockFactory;

#[contractimpl]
impl MockFactory {
    pub fn set_token(e: &Env, artwork_id: BytesN<32>, token: Address) {
        e.storage().persistent().set(&artwork_id, &token);
    }
    pub fn token_of(e: &Env, artwork_id: BytesN<32>) -> Option<Address> {
        e.storage().persistent().get(&artwork_id)
    }
}

const COUNT: i128 = 500;
const GROSS: i128 = 10_000;

#[allow(dead_code)]
struct Setup<'a> {
    env: Env,
    settler_id: Address,
    settler: MarketplaceSettlerClient<'a>,
    factory_id: Address,
    token: FractionTokenClient<'a>,
    usdc: Address,
    admin: Address,
    artist_payout: Address,
    treasury: Address,
    buyer: Address,
    seller: Address,
    artwork_id: BytesN<32>,
}

/// Full harness: mock factory + REAL settler + REAL FractionToken (with
/// `marketplace_settler = settler`) + REAL KYC/freeze + real USDC SAC. Seller is
/// minted `COUNT` fractions, buyer is KYC'd and funded `GROSS` USDC. Auths mocked
/// for the whole build; individual tests adjust the auth posture for the settle.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let artist = Address::generate(&env);
    let artist_payout = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gating_admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    // Mock factory (token_of resolver).
    let factory_id = env.register(MockFactory, ());
    let factory = MockFactoryClient::new(&env, &factory_id);

    // Settler — deployed FIRST so its address is the token's marketplace_settler.
    let settler_id = env.register(MarketplaceSettler, (admin.clone(), factory_id.clone()));
    let settler = MarketplaceSettlerClient::new(&env, &settler_id);

    // Real USDC SAC.
    let usdc_admin = Address::generate(&env);
    let usdc = env
        .register_stellar_asset_contract_v2(usdc_admin)
        .address();

    // Real gating contracts.
    let kyc_id = env.register(KycAllowlist, (gating_admin.clone(),));
    let freeze_id = env.register(EmergencyFreeze, (gating_admin.clone(),));
    let kyc = KycAllowlistClient::new(&env, &kyc_id);

    // Real FractionToken wired to THIS settler; retentions/lockups 0 (seller is a
    // plain holder, not artist/treasury).
    let artwork_id = BytesN::from_array(&env, &[7u8; 32]);
    let init = TokenInit {
        artwork_id: artwork_id.clone(),
        name: String::from_str(&env, "Tove Fraction"),
        symbol: String::from_str(&env, "TOVEF"),
        proxy_admin: admin.clone(),
        artist,
        artist_payout: artist_payout.clone(),
        treasury: treasury.clone(),
        artist_retention: 0,
        artist_lockup_until: 0,
        treasury_retention: 0,
        treasury_lockup_until: 0,
        kyc_allowlist: kyc_id.clone(),
        freeze_set: freeze_id.clone(),
        marketplace_settler: settler_id.clone(),
        minter: minter.clone(),
        usdc: usdc.clone(),
        impl_wasm_hash: BytesN::from_array(&env, &[1u8; 32]),
    };
    let token_id = env.register(FractionToken, (init,));
    let token = FractionTokenClient::new(&env, &token_id);

    // Factory resolves this artwork to the token.
    factory.set_token(&artwork_id, &token_id);

    // Seller holds COUNT fractions (mint path is ungated); buyer is KYC'd and
    // funded so the settle_trade legs succeed.
    token.mint_settle(&minter, &vec![&env, (seller.clone(), COUNT)]);
    kyc.add(&buyer);
    StellarAssetClient::new(&env, &usdc).mint(&buyer, &GROSS);

    Setup {
        env,
        settler_id,
        settler,
        factory_id,
        token,
        usdc,
        admin,
        artist_payout,
        treasury,
        buyer,
        seller,
        artwork_id,
    }
}

fn key(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn usdc_bal(s: &Setup, who: &Address) -> i128 {
    TokenClient::new(&s.env, &s.usdc).balance(who)
}

// ── AE1: happy path ───────────────────────────────────────────────────────────

#[test]
fn accept_quote_settles_the_trade() {
    // AE1 / R2+R5: both parties authorized (mock_all_auths); the settler resolves
    // the token, records the one-shot, and drives settle_trade — fractions move
    // seller→buyer and USDC splits 1.5%/1.5%/rest exactly; trade_settled emitted.
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);

    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    // A successful accept_quote drives settle_trade and (in the same code path,
    // immediately after) emits marketplace.trade_settled. The exact balance/split
    // moves below only occur on that success path, so they prove the settle ran.
    // Fraction leg: seller → buyer.
    assert_eq!(s.token.balance(&s.seller), 0);
    assert_eq!(s.token.balance(&s.buyer), COUNT);

    // USDC split: platform 1.5% = 150, artist 1.5% = 150, seller_net = 9700.
    assert_eq!(usdc_bal(&s, &s.buyer), 0);
    assert_eq!(usdc_bal(&s, &s.treasury), 150);
    assert_eq!(usdc_bal(&s, &s.artist_payout), 150);
    assert_eq!(usdc_bal(&s, &s.seller), 9_700);
    assert_eq!(150 + 150 + 9_700, GROSS);

    assert!(s.settler.is_settled(&rfq, &quote));
}

// ── R2: both auths are required and bound to the tuple ────────────────────────

#[test]
fn accept_quote_requires_both_buyer_and_seller_auth() {
    // R2/AE2/AE3: the happy call requires BOTH buyer and seller to authorize —
    // both appear as authorizers in the recorded auth tree (require_auth_for_args
    // over the exact tuple, host-enforced). Then with authorization withdrawn the
    // call fails, proving the auths are load-bearing (not decorative).
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);

    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    let auths = s.env.auths();
    assert!(
        auths.iter().any(|(a, _)| a == &s.buyer),
        "buyer must be a required authorizer"
    );
    assert!(
        auths.iter().any(|(a, _)| a == &s.seller),
        "seller must be a required authorizer"
    );

    // Withdraw all authorization: a fresh quote cannot settle.
    s.env.set_auths(&[]);
    let rfq2 = key(&s.env, 3);
    let res = s
        .settler
        .try_accept_quote(&rfq2, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);
    assert!(res.is_err(), "accept_quote must require the parties' auth");
    assert!(!s.settler_is_settled_unauthed(&rfq2, &quote));
    assert_eq!(s.token.balance(&s.buyer), COUNT); // unchanged from the first settle
}

// ── AE4: one-shot ─────────────────────────────────────────────────────────────

#[test]
fn accept_quote_is_one_shot_per_quote() {
    // AE4 / R4: a settled (rfq, quote) cannot settle again, even with fresh valid
    // signatures — QuoteAlreadySettled, no second settle_trade.
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);

    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    let res = s
        .settler
        .try_accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);
    assert_eq!(res, Err(Ok(Error::QuoteAlreadySettled)));
    // Balances unchanged by the rejected retry.
    assert_eq!(s.token.balance(&s.buyer), COUNT);
}

// ── AE5: unknown artwork ──────────────────────────────────────────────────────

#[test]
fn accept_quote_unknown_artwork_reverts_token_not_found() {
    // AE5 / R3: an artwork the factory never registered → TokenNotFound; nothing
    // moves, nothing recorded.
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);
    let unknown = key(&s.env, 99);

    let res = s
        .settler
        .try_accept_quote(&rfq, &quote, &unknown, &s.buyer, &s.seller, &COUNT, &GROSS);
    assert_eq!(res, Err(Ok(Error::TokenNotFound)));
    assert!(!s.settler.is_settled(&rfq, &quote));
    assert_eq!(s.token.balance(&s.seller), COUNT); // seller keeps their fractions
}

// ── AE6: admin gating ─────────────────────────────────────────────────────────

#[test]
fn upgrade_and_set_admin_are_admin_gated() {
    // AE6 / R7: set_admin rotates under admin auth; upgrade to the settler's own
    // rebuilt WASM preserves the factory + settled records. (Auth negatives for
    // these are host-enforced by require_auth on the stored admin.)
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);
    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    let new_admin = Address::generate(&s.env);
    s.settler.set_admin(&new_admin);
    assert_eq!(s.settler.admin(), new_admin);
    assert_eq!(s.settler.factory(), s.factory_id);
    // Settled records survive the admin surface unchanged.
    assert!(s.settler.is_settled(&rfq, &quote));
}

// ── TTL refresh-on-read (M5 parity) ───────────────────────────────────────────

#[test]
fn is_settled_read_refreshes_the_marker_ttl() {
    // M5: a settled marker read for a long-lived quote is kept alive by the read.
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);
    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    let marker = DataKey::Settled(rfq.clone(), quote.clone());
    let start = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(start + 100_000);
    let ttl_before = s
        .env
        .as_contract(&s.settler_id, || s.env.storage().persistent().get_ttl(&marker));

    assert!(s.settler.is_settled(&rfq, &quote));
    let ttl_after = s
        .env
        .as_contract(&s.settler_id, || s.env.storage().persistent().get_ttl(&marker));

    assert!(ttl_after > ttl_before, "is_settled must refresh the marker TTL");
}

// Helper: read `is_settled` from storage directly, bypassing the auth-cleared
// client path (used only in the auth-withdrawn negative above).
impl Setup<'_> {
    fn settler_is_settled_unauthed(&self, rfq: &BytesN<32>, quote: &BytesN<32>) -> bool {
        self.env.as_contract(&self.settler_id, || {
            self.env
                .storage()
                .persistent()
                .has(&DataKey::Settled(rfq.clone(), quote.clone()))
        })
    }
}
