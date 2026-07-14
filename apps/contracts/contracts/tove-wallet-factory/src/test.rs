// Needs the built wallet WASM, so it is gated behind the `integration` feature.
// Run: `stellar contract build && stellar contract optimize --wasm \
//   target/wasm32v1-none/release/tove_smart_wallet.wasm` then
//   `cargo test -p tove-wallet-factory --features integration`.
#![cfg(all(test, feature = "integration"))]

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, vec,
    xdr::{ScErrorCode, ScErrorType},
    Address, Bytes, BytesN, Env, Error as SdkError, Map, TryFromVal, Val, Vec,
};
use stellar_accounts::smart_account::Signer;

use crate::{FractionWalletFactory, FractionWalletFactoryClient};

mod wallet {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/tove_smart_wallet.optimized.wasm"
    );
}

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(_e: &Env, _hash: Bytes, _key_data: Val, _sig_data: Val) -> bool {
        true
    }
    pub fn canonicalize_key(e: &Env, key_data: Val) -> Bytes {
        Bytes::try_from_val(e, &key_data).unwrap()
    }
    pub fn batch_canonicalize_key(e: &Env, key_data: Vec<Val>) -> Vec<Bytes> {
        Vec::from_iter(e, key_data.iter().map(|k| Bytes::try_from_val(e, &k).unwrap()))
    }
}

/// Registers the factory (bound to a fresh `admin` + the canonical wallet WASM)
/// and a mock verifier. Returns the client, the verifier address, and the admin.
/// Does NOT mock auths — each test sets its own auth posture so the gating is
/// visible at the call site.
fn setup(e: &Env) -> (FractionWalletFactoryClient<'_>, Address, Address) {
    let admin = Address::generate(e);
    let wasm_hash = e.deployer().upload_contract_wasm(wallet::WASM);
    let factory_id = e.register(FractionWalletFactory, (admin.clone(), wasm_hash));
    let factory = FractionWalletFactoryClient::new(e, &factory_id);
    let verifier = e.register(MockVerifier, ());
    (factory, verifier, admin)
}

fn passkey_signers(e: &Env, verifier: &Address) -> Vec<Signer> {
    vec![
        e,
        Signer::External(
            verifier.clone(),
            Bytes::from_array(e, b"4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29"),
        ),
    ]
}

#[test]
fn factory_deploys_a_working_wallet() {
    let e = Env::default();
    e.mock_all_auths();

    let (factory, verifier, _admin) = setup(&e);
    let signers = passkey_signers(&e, &verifier);
    let policies = Map::<Address, Val>::new(&e);
    let salt = BytesN::from_array(&e, &[7u8; 32]);

    let wallet_addr = factory.deploy_wallet(&salt, &signers, &policies);

    let w = wallet::Client::new(&e, &wallet_addr);
    assert_eq!(w.get_context_rule(&0).signers.len(), 1);
}

/// U4.1 — Deterministic addressing means a salt can only ever be consumed once:
/// the second deploy with the same salt fails because the contract address
/// already exists. Observed behavior (pinned): `try_deploy_wallet` returns
/// `Err(Ok(Error(Context, InvalidAction)))` — the host's "contract already
/// exists" failure escalates through the factory frame as a generic context
/// error, NOT as a typed error from `src/error.rs`.
#[test]
fn deploy_same_salt_twice_fails_second_deploy() {
    let e = Env::default();
    e.mock_all_auths();

    let (factory, verifier, _admin) = setup(&e);
    let signers = passkey_signers(&e, &verifier);
    let policies = Map::<Address, Val>::new(&e);
    let salt = BytesN::from_array(&e, &[42u8; 32]);

    let first = factory.deploy_wallet(&salt, &signers, &policies);
    assert!(wallet::Client::new(&e, &first).get_context_rule(&0).signers.len() == 1);

    let second = factory.try_deploy_wallet(&salt, &signers, &policies);
    assert_eq!(
        second.err().expect("re-deploying an already-consumed salt must fail"),
        Ok(SdkError::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)),
    );
}

/// U4.2 — Two different salts produce two distinct, independently functional
/// wallets, each at the address predicted by the deterministic deployer.
#[test]
fn distinct_salts_yield_two_distinct_working_wallets() {
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();

    let (factory, verifier, _admin) = setup(&e);
    let signers = passkey_signers(&e, &verifier);
    let policies = Map::<Address, Val>::new(&e);
    let salt_a = BytesN::from_array(&e, &[1u8; 32]);
    let salt_b = BytesN::from_array(&e, &[2u8; 32]);

    let wallet_a = factory.deploy_wallet(&salt_a, &signers, &policies);
    let wallet_b = factory.deploy_wallet(&salt_b, &signers, &policies);

    assert_ne!(wallet_a, wallet_b, "different salts must map to different addresses");

    // Addresses are deterministic: derived from (factory address, salt).
    let predicted_a =
        e.deployer().with_address(factory.address.clone(), salt_a).deployed_address();
    let predicted_b =
        e.deployer().with_address(factory.address.clone(), salt_b).deployed_address();
    assert_eq!(wallet_a, predicted_a);
    assert_eq!(wallet_b, predicted_b);

    // Both wallets are live and answer client calls independently.
    assert_eq!(wallet::Client::new(&e, &wallet_a).get_context_rule(&0).signers.len(), 1);
    assert_eq!(wallet::Client::new(&e, &wallet_b).get_context_rule(&0).signers.len(), 1);
}

/// U4.3 — The wallet constructor (OZ `add_context_rule`) rejects an empty
/// signers vec when policies are also empty: `SmartAccountError::
/// NoSignersAndPolicies` (3004) aborts the constructor, so the deploy as a
/// whole fails. Observed behavior (pinned): the constructor abort reaches the
/// caller as `Err(Ok(Error(Context, InvalidAction)))`.
#[test]
fn deploy_with_empty_signers_fails_wallet_constructor() {
    let e = Env::default();
    e.mock_all_auths();

    let (factory, _verifier, _admin) = setup(&e);
    let empty_signers = Vec::<Signer>::new(&e);
    let policies = Map::<Address, Val>::new(&e);
    let salt = BytesN::from_array(&e, &[9u8; 32]);

    let res = factory.try_deploy_wallet(&salt, &empty_signers, &policies);
    assert_eq!(
        res.err().expect("constructor must reject empty signers + empty policies"),
        Ok(SdkError::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)),
    );
}

/// U4.4 (H2 fix) — Deploy authority is GATED to the admin. An unauthenticated
/// caller cannot deploy: `admin.require_auth()` fails with no auth mocked, so
/// no wallet is created. This is the fix for the former "deploy authority open"
/// hijack/malicious-WASM/DoS gap.
#[test]
fn deploy_without_admin_auth_is_rejected() {
    let e = Env::default();
    // Deliberately NO mock_all_auths: the caller cannot satisfy admin auth.

    let (factory, verifier, _admin) = setup(&e);
    let signers = passkey_signers(&e, &verifier);
    let policies = Map::<Address, Val>::new(&e);
    let salt = BytesN::from_array(&e, &[13u8; 32]);

    let res = factory.try_deploy_wallet(&salt, &signers, &policies);
    assert!(res.is_err(), "deploy must require admin authorization");
}

/// U4.5 (H2 fix) — With the admin authorized, the deploy succeeds and the auth
/// tree is rooted at the admin (not an arbitrary caller).
#[test]
fn admin_authorized_deploy_succeeds() {
    let e = Env::default();
    let (factory, verifier, admin) = setup(&e);
    let signers = passkey_signers(&e, &verifier);
    let policies = Map::<Address, Val>::new(&e);
    let salt = BytesN::from_array(&e, &[13u8; 32]);

    e.mock_all_auths();
    let wallet_addr = factory.deploy_wallet(&salt, &signers, &policies);

    // The recorded authorization for the deploy is rooted at the admin.
    let auths = e.auths();
    assert!(
        auths.iter().any(|(addr, _)| addr == &admin),
        "the deploy must be authorized by the stored admin",
    );

    assert_eq!(wallet::Client::new(&e, &wallet_addr).get_context_rule(&0).signers.len(), 1);
}
