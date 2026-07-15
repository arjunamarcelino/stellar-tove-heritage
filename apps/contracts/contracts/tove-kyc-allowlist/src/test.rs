#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env,
};

use crate::{KycAllowlist, KycAllowlistClient};

struct Setup<'a> {
    env: Env,
    admin: Address,
    client: KycAllowlistClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(KycAllowlist, (admin.clone(),));
    let client = KycAllowlistClient::new(&env, &id);
    Setup { env, admin, client }
}

#[test]
fn constructor_sets_admin() {
    let s = setup();
    assert_eq!(s.client.admin(), s.admin);
}

#[test]
fn is_allowed_read_refreshes_the_live_entry_ttl() {
    // M5: an allowlist that is only READ (the token gates every movement here)
    // must not let its live KYC entries archive. A read on an allowed address
    // refreshes that entry's TTL, so it survives well past the 30-day window
    // that a write-only bump would leave it in.
    use crate::storage::DataKey;
    use soroban_sdk::testutils::{storage::Persistent as _, Ledger as _};

    let s = setup();
    s.env.mock_all_auths();
    let alice = Address::generate(&s.env);
    s.client.add(&alice);

    let key = DataKey::Allowed(alice.clone());
    // Advance the ledger so the entry's remaining TTL has visibly decreased.
    let start = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(start + 100_000);
    let ttl_before =
        s.env.as_contract(&s.client.address, || s.env.storage().persistent().get_ttl(&key));

    // The read must bump it back up.
    assert!(s.client.is_allowed(&alice));
    let ttl_after =
        s.env.as_contract(&s.client.address, || s.env.storage().persistent().get_ttl(&key));

    assert!(
        ttl_after > ttl_before,
        "is_allowed must refresh the entry TTL (before {ttl_before}, after {ttl_after})"
    );
}

#[test]
fn unknown_address_is_not_allowed() {
    let s = setup();
    let who = Address::generate(&s.env);
    assert!(!s.client.is_allowed(&who));
}

#[test]
fn admin_add_reflects_in_is_allowed() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.add(&who);
    assert!(s.client.is_allowed(&who));
}

#[test]
fn add_emits_one_event() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.add(&who);
    assert_eq!(s.env.events().all().events().len(), 1);
}

#[test]
fn add_is_idempotent_and_does_not_re_emit() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.add(&who);
    s.client.add(&who); // no-op — must not re-emit
    // `events().all()` reflects only the most recent invocation (the no-op add).
    assert_eq!(s.env.events().all().events().len(), 0);
    assert!(s.client.is_allowed(&who));
}

#[test]
fn admin_remove_reflects_in_is_allowed() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.add(&who);
    s.client.remove(&who);
    assert!(!s.client.is_allowed(&who));
}

#[test]
fn remove_of_unknown_is_noop_no_event() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.remove(&who);
    assert!(!s.client.is_allowed(&who));
    assert_eq!(s.env.events().all().events().len(), 0);
}

#[test]
fn add_without_admin_auth_is_rejected() {
    let s = setup();
    let who = Address::generate(&s.env);
    assert!(s.client.try_add(&who).is_err());
}

#[test]
fn remove_without_admin_auth_is_rejected_and_leaves_state() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.add(&who);

    s.env.mock_auths(&[]); // drop all authorizations
    assert!(s.client.try_remove(&who).is_err());

    s.env.mock_all_auths();
    assert!(s.client.is_allowed(&who)); // unauthorized remove didn't mutate
}

#[test]
fn set_admin_transfers_authority() {
    let s = setup();
    s.env.mock_all_auths();
    let new_admin = Address::generate(&s.env);
    s.client.set_admin(&new_admin);
    assert_eq!(s.client.admin(), new_admin);
}

#[test]
fn set_admin_without_auth_is_rejected() {
    let s = setup();
    let new_admin = Address::generate(&s.env);
    assert!(s.client.try_set_admin(&new_admin).is_err());
}

#[test]
fn addresses_are_independent() {
    let s = setup();
    s.env.mock_all_auths();
    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    s.client.add(&a);
    assert!(s.client.is_allowed(&a));
    assert!(!s.client.is_allowed(&b));
}
