use soroban_sdk::{contract, contractimpl, Address, Env};

use crate::events::{KycAdded, KycRemoved};
use crate::storage::{extend_allowed_ttl, extend_instance_ttl, DataKey};

#[contract]
pub struct KycAllowlist;

#[contractimpl]
impl KycAllowlist {
    /// Bind the allowlist to its `admin`. Runs once at deploy.
    pub fn __constructor(env: &Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        extend_instance_ttl(env);
    }

    /// Is `addr` KYC-approved? Defaults to `false`. Refreshes the instance TTL
    /// and, when the address IS allowed, its own entry TTL — so an actively
    /// consulted allowlist (the token gates every movement through here) keeps
    /// both the contract and live KYC entries from silently archiving after 30
    /// days of admin write-inactivity (M5).
    pub fn is_allowed(env: &Env, addr: Address) -> bool {
        extend_instance_ttl(env);
        let allowed = env
            .storage()
            .persistent()
            .get(&DataKey::Allowed(addr.clone()))
            .unwrap_or(false);
        if allowed {
            extend_allowed_ttl(env, &addr);
        }
        allowed
    }

    /// Add `addr` to the allowlist. Admin-only. Idempotent: a no-op (and no
    /// event) if `addr` is already allowed.
    pub fn add(env: &Env, addr: Address) {
        require_admin(env);
        let key = DataKey::Allowed(addr.clone());
        if env.storage().persistent().get(&key).unwrap_or(false) {
            return;
        }
        env.storage().persistent().set(&key, &true);
        extend_allowed_ttl(env, &addr);
        KycAdded { addr }.publish(env);
    }

    /// Remove `addr` from the allowlist. Admin-only. Idempotent: a no-op (and no
    /// event) if `addr` is not currently allowed.
    pub fn remove(env: &Env, addr: Address) {
        require_admin(env);
        let key = DataKey::Allowed(addr.clone());
        if !env.storage().persistent().get(&key).unwrap_or(false) {
            return;
        }
        env.storage().persistent().remove(&key);
        KycRemoved { addr }.publish(env);
    }

    /// The current admin authority.
    pub fn admin(env: &Env) -> Address {
        extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Transfer admin authority (e.g. single key → multi-sig account). Admin-only.
    pub fn set_admin(env: &Env, new_admin: Address) {
        require_admin(env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        extend_instance_ttl(env);
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}
