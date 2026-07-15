#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, BytesN, Env,
};

use crate::{Error, RegistryAnchor, RegistryAnchorClient};

struct Setup<'a> {
    env: Env,
    admin: Address,
    client: RegistryAnchorClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(RegistryAnchor, (admin.clone(),));
    let client = RegistryAnchorClient::new(&env, &id);
    Setup { env, admin, client }
}

fn root_bytes(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

const DATE_D: u32 = 20260706;
const DATE_E: u32 = 20260707;

#[test]
fn constructor_sets_admin() {
    let s = setup();
    assert_eq!(s.client.admin(), s.admin);
}

#[test]
fn unanchored_date_has_no_root() {
    let s = setup();
    assert_eq!(s.client.root(&DATE_D), None);
}

#[test]
fn admin_emit_reflects_in_root() {
    let s = setup();
    s.env.mock_all_auths();
    let r = root_bytes(&s.env, 1);
    s.client.emit(&r, &DATE_D);
    assert_eq!(s.client.root(&DATE_D), Some(r));
}

#[test]
fn emit_publishes_one_event_with_root_and_date() {
    let s = setup();
    s.env.mock_all_auths();
    let r = root_bytes(&s.env, 1);
    s.client.emit(&r, &DATE_D);
    let events = s.env.events().all();
    assert_eq!(events.events().len(), 1);
    // The (merkle_root, batch_date) pair rides in the topics after the static
    // ["registry", "anchored"] prefix — assert the full topic vector shape.
    let all = events.events();
    let event = all.last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
    assert_eq!(body.topics.len(), 4); // "registry", "anchored", merkle_root, batch_date
}

#[test]
fn reemission_for_same_date_fails_and_preserves_root() {
    let s = setup();
    s.env.mock_all_auths();
    let r1 = root_bytes(&s.env, 1);
    let r2 = root_bytes(&s.env, 2);
    s.client.emit(&r1, &DATE_D);

    let res = s.client.try_emit(&r2, &DATE_D);
    assert_eq!(res, Err(Ok(Error::DateAlreadyAnchored)));
    assert_eq!(s.client.root(&DATE_D), Some(r1)); // original root untouched
    // The failed invocation must not publish an event. `events().all()`
    // reflects only the most recent invocation (the failed emit).
    assert_eq!(s.env.events().all().events().len(), 0);
}

#[test]
fn emit_without_admin_auth_is_rejected_and_date_stays_unanchored() {
    let s = setup();
    let r = root_bytes(&s.env, 1);
    assert!(s.client.try_emit(&r, &DATE_D).is_err());
    s.env.mock_all_auths();
    assert_eq!(s.client.root(&DATE_D), None);
}

#[test]
fn dates_are_independent() {
    let s = setup();
    s.env.mock_all_auths();
    let r1 = root_bytes(&s.env, 1);
    let r2 = root_bytes(&s.env, 2);
    s.client.emit(&r1, &DATE_D);
    s.client.emit(&r2, &DATE_E);
    assert_eq!(s.client.root(&DATE_D), Some(r1));
    assert_eq!(s.client.root(&DATE_E), Some(r2));
}

#[test]
fn same_root_may_anchor_two_different_dates() {
    let s = setup();
    s.env.mock_all_auths();
    let r = root_bytes(&s.env, 7);
    s.client.emit(&r, &DATE_D);
    s.client.emit(&r, &DATE_E); // uniqueness is per date, not per root
    assert_eq!(s.client.root(&DATE_D), Some(r.clone()));
    assert_eq!(s.client.root(&DATE_E), Some(r));
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
