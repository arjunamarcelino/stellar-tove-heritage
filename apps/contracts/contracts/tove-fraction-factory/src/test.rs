#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, Address, BytesN, Env, IntoVal, Map, String, Symbol, Val,
};
use tove_fraction_token::TokenInit;

use crate::{Error, FractionTokenFactory, FractionTokenFactoryClient};

// The token's built WASM — the canonical executable the factory instantiates.
// Built by `stellar contract build` before `cargo test` (same arrangement as
// the fraction-token test / CI).
mod token_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/tove_fraction_token.wasm"
    );
}

const ARTIST_RETENTION: i128 = 100;
const ARTIST_LOCKUP_UNTIL: u64 = 1_790_000_000;
const TREASURY_RETENTION: i128 = 50;
const TREASURY_LOCKUP_UNTIL: u64 = 1_795_000_000;

/// Deliberately-wrong implementation hash carried by every test `TokenInit`:
/// the factory MUST override it with the stored canonical hash (TOV-146), so
/// no deployed token may ever report this value.
fn bogus_impl_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[9u8; 32])
}

struct Setup<'a> {
    env: Env,
    factory_id: Address,
    factory: FractionTokenFactoryClient<'a>,
    admin: Address,
    canonical_hash: BytesN<32>,
}

/// Uploads the real token WASM and registers the factory with its hash as the
/// canonical one. Does NOT mock auths — callers opt in explicitly so the auth
/// posture of each test is visible at the call site.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);
    let canonical_hash = env.deployer().upload_contract_wasm(token_wasm::WASM);
    let factory_id = env.register(FractionTokenFactory, (admin.clone(), canonical_hash.clone()));
    let factory = FractionTokenFactoryClient::new(&env, &factory_id);
    Setup { env, factory_id, factory, admin, canonical_hash }
}

/// TokenInit fixture (shape mirrors the fraction-token test builder). The
/// `impl_wasm_hash` is always the bogus one — the override is the factory's
/// job.
fn token_init(s: &Setup, artwork_byte: u8) -> TokenInit {
    let env = &s.env;
    TokenInit {
        artwork_id: BytesN::from_array(env, &[artwork_byte; 32]),
        name: String::from_str(env, "Tove Fraction Artwork 7"),
        symbol: String::from_str(env, "TOVE7"),
        proxy_admin: s.admin.clone(),
        artist: Address::generate(env),
        artist_payout: Address::generate(env),
        treasury: Address::generate(env),
        artist_retention: ARTIST_RETENTION,
        artist_lockup_until: ARTIST_LOCKUP_UNTIL,
        treasury_retention: TREASURY_RETENTION,
        treasury_lockup_until: TREASURY_LOCKUP_UNTIL,
        kyc_allowlist: Address::generate(env),
        freeze_set: Address::generate(env),
        marketplace_settler: Address::generate(env),
        minter: Address::generate(env),
        usdc: Address::generate(env),
        impl_wasm_hash: bogus_impl_hash(env),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor / getters
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn constructor_sets_admin_and_canonical_hash() {
    let s = setup();
    assert_eq!(s.factory.admin(), s.admin);
    assert_eq!(s.factory.wasm_hash(), s.canonical_hash);
}

#[test]
fn token_of_unknown_artwork_is_none() {
    let s = setup();
    let unknown = BytesN::from_array(&s.env, &[42u8; 32]);
    assert_eq!(s.factory.token_of(&unknown), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// AE1 — admin deploy: deterministic address, registry, event, working token,
// canonical-hash override
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn admin_deploy_births_working_token_at_predicted_address_with_canonical_hash() {
    let s = setup();
    s.env.mock_all_auths();
    let init = token_init(&s, 7);
    let artwork_id = init.artwork_id.clone();

    let token = s.factory.deploy(&init);

    // factory.deployed event: topics ["factory", "deployed", artwork_id,
    // token] (indexer-filterable), canonical hash in the data map. Asserted
    // BEFORE any other client call — events reflect only the most recent
    // invocation. The token constructor emits nothing, so this is the
    // invocation's single event.
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "wasm_hash"), s.canonical_hash.clone().into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.factory_id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "factory").into_val(&s.env),
                    Symbol::new(&s.env, "deployed").into_val(&s.env),
                    artwork_id.into_val(&s.env),
                    token.into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );

    // Deterministic address: derived from (factory address, salt = artwork_id).
    let predicted = s
        .env
        .deployer()
        .with_address(s.factory_id.clone(), artwork_id.clone())
        .deployed_address();
    assert_eq!(token, predicted);

    // Registry filled.
    assert_eq!(s.factory.token_of(&artwork_id), Some(token.clone()));

    // The deployed token is live and correctly constructed.
    let t = token_wasm::Client::new(&s.env, &token);
    assert_eq!(t.name(), String::from_str(&s.env, "Tove Fraction Artwork 7"));
    assert_eq!(t.symbol(), String::from_str(&s.env, "TOVE7"));
    assert_eq!(t.artwork_id(), artwork_id);
    assert_eq!(t.proxy_admin(), s.admin);

    // Override proof (TOV-146): init carried a bogus hash, but the token
    // records the factory's canonical hash.
    assert_ne!(init.impl_wasm_hash, s.canonical_hash);
    assert_eq!(t.impl_wasm_hash(), s.canonical_hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-04.12 #2 — "non-audited rejected": a caller CANNOT choose the deployed
// bytecode. The `impl_wasm_hash` in TokenInit is caller-supplied and arbitrary;
// the factory overrides it with its stored canonical hash, so the born token
// always reports the canonical (audited) hash — never the caller's value. This
// is the on-chain equivalent of rejecting a non-canonical executable.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn deploy_ignores_caller_wasm_hash_and_uses_canonical_fr_04_12() {
    let s = setup();
    s.env.mock_all_auths();

    // A blatantly bogus, attacker-chosen impl hash in the init payload.
    let mut init = token_init(&s, 42);
    init.impl_wasm_hash = BytesN::from_array(&s.env, &[0xEEu8; 32]);
    assert_ne!(
        init.impl_wasm_hash, s.canonical_hash,
        "precondition: caller hash differs from the canonical one"
    );

    let token = s.factory.deploy(&init);

    // The deployed token reports the factory's canonical hash, NOT the caller's
    // arbitrary value — the caller could not sneak in unaudited bytecode.
    let t = token_wasm::Client::new(&s.env, &token);
    assert_eq!(t.impl_wasm_hash(), s.canonical_hash);
    assert_ne!(t.impl_wasm_hash(), init.impl_wasm_hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// AE2 — duplicate artwork is a typed error with no side effects
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn second_deploy_for_same_artwork_reverts_and_leaves_registry_intact() {
    let s = setup();
    s.env.mock_all_auths();
    let init = token_init(&s, 7);
    let artwork_id = init.artwork_id.clone();
    let first = s.factory.deploy(&init);

    // Different init payload, same artwork_id — still rejected: uniqueness is
    // keyed on the artwork, not the full init.
    let mut again = token_init(&s, 7);
    again.name = String::from_str(&s.env, "Impostor");
    let res = s.factory.try_deploy(&again);

    assert_eq!(res, Err(Ok(Error::ArtworkAlreadyDeployed)));
    // The failed invocation must not publish an event. `events().all()`
    // reflects only the most recent invocation (the failed deploy).
    assert_eq!(s.env.events().all().events().len(), 0);
    // Registry unchanged: still the first token.
    assert_eq!(s.factory.token_of(&artwork_id), Some(first));
}

// ─────────────────────────────────────────────────────────────────────────────
// AE3 — deploy authority is admin-gated from day one
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn deploy_without_admin_auth_is_rejected_and_registry_untouched() {
    let s = setup();
    // Deliberately NO mock_all_auths: an unauthenticated caller fails at the
    // host auth layer — an invoke error (Err(Err(..))), not a typed error.
    let init = token_init(&s, 7);
    let artwork_id = init.artwork_id.clone();

    let res = s.factory.try_deploy(&init);

    assert!(matches!(res, Err(Err(_))));
    s.env.mock_all_auths();
    assert_eq!(s.factory.token_of(&artwork_id), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// Two artworks → two independent tokens
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn distinct_artworks_yield_two_distinct_working_tokens() {
    let s = setup();
    s.env.mock_all_auths();
    let init_a = token_init(&s, 1);
    let init_b = token_init(&s, 2);
    let artwork_a = init_a.artwork_id.clone();
    let artwork_b = init_b.artwork_id.clone();

    let token_a = s.factory.deploy(&init_a);
    let token_b = s.factory.deploy(&init_b);

    assert_ne!(token_a, token_b, "different artworks must map to different addresses");
    assert_eq!(s.factory.token_of(&artwork_a), Some(token_a.clone()));
    assert_eq!(s.factory.token_of(&artwork_b), Some(token_b.clone()));

    // Both tokens are live, independent, and canonical.
    let ta = token_wasm::Client::new(&s.env, &token_a);
    let tb = token_wasm::Client::new(&s.env, &token_b);
    assert_eq!(ta.artwork_id(), artwork_a);
    assert_eq!(tb.artwork_id(), artwork_b);
    assert_eq!(ta.impl_wasm_hash(), s.canonical_hash);
    assert_eq!(tb.impl_wasm_hash(), s.canonical_hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical-hash rotation (set_wasm_hash)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn set_wasm_hash_rotates_hash_emits_old_new_and_future_deploys_use_stored_hash() {
    let s = setup();
    s.env.mock_all_auths();

    // Rotate to a hash with NO installed executable behind it.
    let uninstalled = BytesN::from_array(&s.env, &[0xAAu8; 32]);
    s.factory.set_wasm_hash(&uninstalled);

    // wasm_hash.updated event: topics ["wasm_hash", "updated", old, new] —
    // hashes ride in the topics (proxy.upgraded style); no data fields, so
    // the data section is an empty map.
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.factory_id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "wasm_hash").into_val(&s.env),
                    Symbol::new(&s.env, "updated").into_val(&s.env),
                    s.canonical_hash.clone().into_val(&s.env),
                    uninstalled.clone().into_val(&s.env),
                ],
                Map::<Symbol, Val>::new(&s.env).into_val(&s.env),
            ),
        ]
    );
    assert_eq!(s.factory.wasm_hash(), uninstalled);

    // Behavioral proof that deploy_v2 receives the STORED hash: with the
    // rotated (uninstalled) hash the deploy fails at the host layer — a real
    // failure, not a typed factory error — and leaves no registry residue.
    let init = token_init(&s, 3);
    let artwork_id = init.artwork_id.clone();
    let res = s.factory.try_deploy(&init);
    assert!(matches!(res, Err(Err(_))));
    assert_eq!(s.factory.token_of(&artwork_id), None);

    // Rotate back to the canonical hash: the SAME artwork now deploys fine
    // and reports the restored hash — the stored value flows to deploy_v2.
    s.factory.set_wasm_hash(&s.canonical_hash);
    let token = s.factory.deploy(&init);
    assert_eq!(s.factory.token_of(&artwork_id), Some(token.clone()));
    assert_eq!(token_wasm::Client::new(&s.env, &token).impl_wasm_hash(), s.canonical_hash);
}

#[test]
fn set_wasm_hash_without_auth_is_rejected_and_hash_unchanged() {
    let s = setup();
    let other = BytesN::from_array(&s.env, &[0xBBu8; 32]);
    assert!(s.factory.try_set_wasm_hash(&other).is_err());
    assert_eq!(s.factory.wasm_hash(), s.canonical_hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin transfer
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn set_admin_transfers_authority() {
    let s = setup();
    s.env.mock_all_auths();
    let new_admin = Address::generate(&s.env);
    s.factory.set_admin(&new_admin);
    assert_eq!(s.factory.admin(), new_admin);
}

#[test]
fn set_admin_without_auth_is_rejected() {
    let s = setup();
    let new_admin = Address::generate(&s.env);
    assert!(s.factory.try_set_admin(&new_admin).is_err());
    assert_eq!(s.factory.admin(), s.admin);
}
