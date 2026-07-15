//! TOV-179 — MarketplaceSettler end-to-end, real stack, no mocks.
//!
//! One in-process `Env` hosts the REAL settle path: the real fraction-factory
//! deploys a real FractionToken (from the canonical WASM) wired with
//! `marketplace_settler = <settler>`, and the settler resolves that token
//! canonically via `factory.token_of(artwork_id)` and drives `settle_trade`.
//! This exercises the deploy-order wiring and the real `token_of` resolution
//! that the settler's own unit suite stubs with a mock factory.

#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, String,
};
use tove_emergency_freeze::EmergencyFreeze;
use tove_fraction_factory::{FractionTokenFactory, FractionTokenFactoryClient};
use tove_fraction_token::{FractionTokenClient, TokenInit};
use tove_kyc_allowlist::{KycAllowlist, KycAllowlistClient};
use tove_marketplace_settler::{Error as SettlerError, MarketplaceSettler, MarketplaceSettlerClient};

// The canonical FractionToken artifact the factory deploys on-chain.
mod fraction_token_wasm {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/tove_fraction_token.wasm"
    );
}

const COUNT: i128 = 500;
const GROSS: i128 = 10_000;

struct Setup<'a> {
    env: Env,
    settler: MarketplaceSettlerClient<'a>,
    factory: FractionTokenFactoryClient<'a>,
    token: FractionTokenClient<'a>,
    usdc: Address,
    artist_payout: Address,
    treasury: Address,
    buyer: Address,
    seller: Address,
    artwork_id: BytesN<32>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let artist = Address::generate(&env);
    let artist_payout = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gating_admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    // Real fraction-factory bound to the canonical FractionToken WASM.
    let canonical_hash = env
        .deployer()
        .upload_contract_wasm(fraction_token_wasm::WASM);
    let factory_id = env.register(FractionTokenFactory, (admin.clone(), canonical_hash));
    let factory = FractionTokenFactoryClient::new(&env, &factory_id);

    // Settler FIRST — its address is each token's marketplace_settler.
    let settler_id = env.register(MarketplaceSettler, (admin.clone(), factory_id.clone()));
    let settler = MarketplaceSettlerClient::new(&env, &settler_id);

    // Real USDC SAC + real gating.
    let usdc_admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(usdc_admin).address();
    let kyc_id = env.register(KycAllowlist, (gating_admin.clone(),));
    let freeze_id = env.register(EmergencyFreeze, (gating_admin.clone(),));
    let kyc = KycAllowlistClient::new(&env, &kyc_id);

    // Deploy the token THROUGH the factory (salt = artwork_id, canonical hash
    // forced) wired to this settler.
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
        // Overwritten with the canonical hash by the factory (FR-04.12).
        impl_wasm_hash: BytesN::from_array(&env, &[0u8; 32]),
    };
    let token_id = factory.deploy(&init);

    // The settler resolves the SAME token the factory registered.
    assert_eq!(factory.token_of(&artwork_id), Some(token_id.clone()));
    let token = FractionTokenClient::new(&env, &token_id);

    // Seller holds COUNT fractions; buyer is KYC'd and funded.
    token.mint_settle(&minter, &vec![&env, (seller.clone(), COUNT)]);
    kyc.add(&buyer);
    StellarAssetClient::new(&env, &usdc).mint(&buyer, &GROSS);

    Setup {
        env,
        settler,
        factory,
        token,
        usdc,
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

#[test]
fn settler_drives_real_settle_trade_through_factory_deployed_token() {
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);
    let usdc = TokenClient::new(&s.env, &s.usdc);

    s.settler
        .accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);

    // Fraction leg seller → buyer; USDC split 1.5% / 1.5% / rest via the real token.
    assert_eq!(s.token.balance(&s.seller), 0);
    assert_eq!(s.token.balance(&s.buyer), COUNT);
    assert_eq!(usdc.balance(&s.buyer), 0);
    assert_eq!(usdc.balance(&s.treasury), 150);
    assert_eq!(usdc.balance(&s.artist_payout), 150);
    assert_eq!(usdc.balance(&s.seller), 9_700);
    assert!(s.settler.is_settled(&rfq, &quote));

    // One-shot: the same quote cannot settle again.
    let retry = s
        .settler
        .try_accept_quote(&rfq, &quote, &s.artwork_id, &s.buyer, &s.seller, &COUNT, &GROSS);
    assert_eq!(retry, Err(Ok(SettlerError::QuoteAlreadySettled)));
}

#[test]
fn settler_reverts_token_not_found_for_undeployed_artwork() {
    let s = setup();
    let rfq = key(&s.env, 1);
    let quote = key(&s.env, 2);
    let unknown = key(&s.env, 99);

    // The factory never deployed a token for this artwork.
    assert_eq!(s.factory.token_of(&unknown), None);
    let res = s
        .settler
        .try_accept_quote(&rfq, &quote, &unknown, &s.buyer, &s.seller, &COUNT, &GROSS);
    assert_eq!(res, Err(Ok(SettlerError::TokenNotFound)));
    assert_eq!(s.token.balance(&s.seller), COUNT);
}
