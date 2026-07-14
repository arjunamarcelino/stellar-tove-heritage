#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, BytesN, Env,
};

use crate::{EmergencyFreeze, EmergencyFreezeClient};

struct Setup<'a> {
    env: Env,
    admin: Address,
    client: EmergencyFreezeClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(EmergencyFreeze, (admin.clone(),));
    let client = EmergencyFreezeClient::new(&env, &id);
    Setup { env, admin, client }
}

fn reason(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn constructor_sets_admin() {
    let s = setup();
    assert_eq!(s.client.admin(), s.admin);
}

#[test]
fn unknown_address_is_not_frozen() {
    let s = setup();
    let who = Address::generate(&s.env);
    assert!(!s.client.is_frozen(&who));
}

#[test]
fn admin_freeze_reflects_in_is_frozen() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.freeze(&who, &reason(&s.env, 1));
    assert!(s.client.is_frozen(&who));
}

#[test]
fn freeze_emits_one_event() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.freeze(&who, &reason(&s.env, 1));
    assert_eq!(s.env.events().all().events().len(), 1);
}

#[test]
fn freeze_is_idempotent_and_does_not_re_emit() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.freeze(&who, &reason(&s.env, 1));
    s.client.freeze(&who, &reason(&s.env, 2)); // no-op — must not re-emit
    // `events().all()` reflects only the most recent invocation (the no-op).
    assert_eq!(s.env.events().all().events().len(), 0);
    assert!(s.client.is_frozen(&who));
}

#[test]
fn admin_unfreeze_reflects_in_is_frozen() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.freeze(&who, &reason(&s.env, 1));
    s.client.unfreeze(&who, &reason(&s.env, 9));
    assert!(!s.client.is_frozen(&who));
}

#[test]
fn unfreeze_of_unknown_is_noop_no_event() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.unfreeze(&who, &reason(&s.env, 1));
    assert!(!s.client.is_frozen(&who));
    assert_eq!(s.env.events().all().events().len(), 0);
}

#[test]
fn freeze_without_admin_auth_is_rejected() {
    let s = setup();
    let who = Address::generate(&s.env);
    assert!(s.client.try_freeze(&who, &reason(&s.env, 1)).is_err());
}

#[test]
fn unfreeze_without_admin_auth_is_rejected_and_leaves_state() {
    let s = setup();
    s.env.mock_all_auths();
    let who = Address::generate(&s.env);
    s.client.freeze(&who, &reason(&s.env, 1));

    s.env.mock_auths(&[]); // drop all authorizations
    assert!(s.client.try_unfreeze(&who, &reason(&s.env, 2)).is_err());

    s.env.mock_all_auths();
    assert!(s.client.is_frozen(&who)); // unauthorized unfreeze didn't mutate
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
    s.client.freeze(&a, &reason(&s.env, 1));
    assert!(s.client.is_frozen(&a));
    assert!(!s.client.is_frozen(&b));
}
