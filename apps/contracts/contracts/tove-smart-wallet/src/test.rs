#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::smart_account::{Signer, SmartAccountError};

use crate::{ToveSmartWallet, ToveSmartWalletClient};

// The wallet's own built WASM — used as a known-valid executable for the
// upgrade happy path. Built by `stellar contract build` (see CI / factory test).
mod wallet_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/tove_smart_wallet.wasm"
    );
}

// A stand-in verifier that accepts everything — lets us test the wallet's own
// logic (construction, transfer wrapper, signer management) without real crypto.
// The actual secp256r1/WebAuthn verification is covered by OZ's verifier tests.
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

const PASSKEY_A: &[u8; 64] = b"4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29";
const PASSKEY_B: &[u8; 64] = b"3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

fn external_signer(e: &Env, verifier: &Address, key: &[u8; 64]) -> Signer {
    Signer::External(verifier.clone(), Bytes::from_array(e, key))
}

/// Register a wallet bound to a single passkey signer (via the mock verifier),
/// no policies. Returns (env, wallet_id, client).
fn setup<'a>() -> (Env, Address, ToveSmartWalletClient<'a>) {
    let e = Env::default();
    let verifier = e.register(MockVerifier, ());
    let signers = vec![&e, external_signer(&e, &verifier, PASSKEY_A)];
    let wallet_id = e.register(ToveSmartWallet, (signers, Map::<Address, Val>::new(&e)));
    let client = ToveSmartWalletClient::new(&e, &wallet_id);
    (e, wallet_id, client)
}

#[test]
fn constructs_with_passkey_signer() {
    let (_e, _id, wallet) = setup();
    let rule = wallet.get_context_rule(&0);
    assert_eq!(rule.signers.len(), 1);
}

#[test]
fn transfer_moves_tokens_when_authorized() {
    let (e, wallet_id, wallet) = setup();
    e.mock_all_auths();

    let issuer = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&e, &token).mint(&wallet_id, &1_000);

    let to = Address::generate(&e);
    wallet.transfer(&token, &to, &100);

    let tc = TokenClient::new(&e, &token);
    assert_eq!(tc.balance(&wallet_id), 900);
    assert_eq!(tc.balance(&to), 100);
}

#[test]
fn batch_add_signer_appends_making_the_rule_multi_signer() {
    // batch_add_signer APPENDS — it does not rotate. On the factory's no-policy
    // rule this turns a 1-of-1 wallet into a 2-of-N (all signers must co-sign);
    // see the entrypoint doc (M4). Pinned so the name no longer misleads.
    let (e, _id, wallet) = setup();
    e.mock_all_auths();

    let verifier = e.register(MockVerifier, ());
    let new_signer = external_signer(&e, &verifier, PASSKEY_B);
    wallet.batch_add_signer(&0, &vec![&e, new_signer]);

    assert_eq!(wallet.get_context_rule(&0).signers.len(), 2);
}

#[test]
fn rotate_via_add_then_remove_keeps_the_rule_single_signer() {
    // The CORRECT passkey rotation (M4): add the new signer, remove the old one,
    // both self-authorized SmartAccount ops — the rule returns to a single
    // signer, so no N-of-N lock is created. This is the recovery primitive the
    // batch_add_signer doc points to.
    let (e, _id, wallet) = setup();
    e.mock_all_auths();

    let rule = wallet.get_context_rule(&0);
    assert_eq!(rule.signers.len(), 1);
    let old_signer_id = rule.signer_ids.get_unchecked(0);

    let verifier = e.register(MockVerifier, ());
    let new_signer = external_signer(&e, &verifier, PASSKEY_B);
    wallet.add_signer(&0, &new_signer);
    wallet.remove_signer(&0, &old_signer_id);

    let after = wallet.get_context_rule(&0);
    assert_eq!(after.signers.len(), 1, "rotation must leave exactly one signer");
    assert_eq!(after.signers.get_unchecked(0), new_signer);
}

// ── TOV-39: fail-closed auth invariant ───────────────────────────────────────
// Every state-mutating method requires the wallet's own authorization, which the
// host routes through `__check_auth` → OZ `do_check_auth` → the passkey verifier.
// These tests assert that without a valid signer authorization the call is
// rejected (no funds move, no state changes). This is the on-chain enforcement
// behind the Gherkin scenarios "stolen relayer key" and "admin multi-sig" — any
// actor lacking the bound passkey cannot produce a passing authorization.
//
// The signature-mismatch crypto itself (a wrong P-256 sig → reject) is delegated
// to OZ's audited `do_check_auth` + the WebAuthn verifier and is covered by their
// tests; an end-to-end check with a real P-256 signature belongs in a testnet
// integration test.

#[test]
fn transfer_without_authorization_is_rejected() {
    let (e, _id, wallet) = setup();
    // No auth provided: neither the bound passkey nor anyone else authorizes.
    let token = Address::generate(&e);
    let to = Address::generate(&e);

    let res = wallet.try_transfer(&token, &to, &100);

    assert!(res.is_err());
}

#[test]
fn rotate_signer_without_authorization_is_rejected() {
    let (e, _id, wallet) = setup();
    let verifier = e.register(MockVerifier, ());
    let new_signer = external_signer(&e, &verifier, PASSKEY_B);

    let res = wallet.try_batch_add_signer(&0, &vec![&e, new_signer]);

    assert!(res.is_err());
    // Signer set is unchanged — no unauthorized mutation slipped through.
    e.mock_all_auths();
    assert_eq!(wallet.get_context_rule(&0).signers.len(), 1);
}

#[test]
fn upgrade_without_authorization_is_rejected() {
    let (e, _id, wallet) = setup();
    let new_wasm_hash = BytesN::from_array(&e, &[0u8; 32]);
    let operator = Address::generate(&e);

    let res = wallet.try_upgrade(&new_wasm_hash, &operator);

    assert!(res.is_err());
}

// ── U3: upgrade happy path, OZ signer-management edges, transfer failure &
//    event payload ────────────────────────────────────────────────────────────

#[test]
fn upgrade_with_authorization_and_valid_wasm_succeeds() {
    let (e, _id, wallet) = setup();
    e.mock_all_auths();

    // A real, valid executable uploaded to the host — the wallet's own WASM.
    let new_wasm_hash = e.deployer().upload_contract_wasm(wallet_wasm::WASM);
    let operator = Address::generate(&e);

    wallet.upgrade(&new_wasm_hash, &operator);

    // Post-upgrade the wallet runs the uploaded executable; its persistent
    // state (the bound signer) is intact and readable.
    assert_eq!(wallet.get_context_rule(&0).signers.len(), 1);
}

#[test]
fn batch_add_signer_with_empty_vec_is_a_noop() {
    // Pinned OZ behavior (stellar-accounts 0.7.2): an empty batch succeeds and
    // changes nothing — the validation/registration loop simply runs zero times.
    let (e, _id, wallet) = setup();
    e.mock_all_auths();

    let res = wallet.try_batch_add_signer(&0, &Vec::<Signer>::new(&e));

    assert!(res.is_ok());
    assert_eq!(wallet.get_context_rule(&0).signers.len(), 1);
}

#[test]
fn batch_add_signer_with_already_present_signer_fails_duplicate_signer() {
    // Pinned OZ behavior (stellar-accounts 0.7.2): re-adding a signer already
    // bound to the rule fails with SmartAccountError::DuplicateSigner (#3007)
    // via canonical-key comparison, and the signer set is left unchanged.
    let (e, _id, wallet) = setup();
    e.mock_all_auths();

    let existing = wallet.get_context_rule(&0).signers.get_unchecked(0);
    let res = wallet.try_batch_add_signer(&0, &vec![&e, existing]);

    assert_eq!(res, Err(Ok(SmartAccountError::DuplicateSigner.into())));
    assert_eq!(wallet.get_context_rule(&0).signers.len(), 1);
}

#[test]
fn transfer_exceeding_balance_fails_and_leaves_balance_unchanged() {
    let (e, wallet_id, wallet) = setup();
    e.mock_all_auths();

    let issuer = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&e, &token).mint(&wallet_id, &100);

    let to = Address::generate(&e);
    // Even fully authorized, the SAC rejects a transfer beyond the balance and
    // the failure propagates out of the wallet's `transfer` wrapper.
    let res = wallet.try_transfer(&token, &to, &1_000);

    assert!(res.is_err());
    let tc = TokenClient::new(&e, &token);
    assert_eq!(tc.balance(&wallet_id), 100);
    assert_eq!(tc.balance(&to), 0);
}

#[test]
fn transfer_event_carries_from_to_token_and_amount() {
    let (e, wallet_id, wallet) = setup();
    e.mock_all_auths();

    let issuer = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&e, &token).mint(&wallet_id, &1_000);

    let to = Address::generate(&e);
    wallet.transfer(&token, &to, &250);

    // TransferEvent (#[contractevent(topics = ["transfer"])], no #[topic]
    // fields) → topics = ["transfer"], data = map { from, to, token, amount }.
    let mut data = Map::<Symbol, Val>::new(&e);
    data.set(Symbol::new(&e, "from"), wallet_id.into_val(&e));
    data.set(Symbol::new(&e, "to"), to.into_val(&e));
    data.set(Symbol::new(&e, "token"), token.into_val(&e));
    data.set(Symbol::new(&e, "amount"), 250_i128.into_val(&e));

    assert_eq!(
        e.events().all().filter_by_contract(&wallet_id),
        vec![
            &e,
            (
                wallet_id.clone(),
                vec![&e, Symbol::new(&e, "transfer").into_val(&e)],
                data.into_val(&e),
            ),
        ]
    );
}
