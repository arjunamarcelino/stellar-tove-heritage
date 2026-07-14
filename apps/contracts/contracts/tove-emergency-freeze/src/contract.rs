use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

use crate::events::{FreezeAdded, FreezeRemoved};
use crate::storage::{extend_frozen_ttl, extend_instance_ttl, DataKey};

#[contract]
pub struct EmergencyFreeze;

#[contractimpl]
impl EmergencyFreeze {
    /// Bind the freeze set to its `admin`. Runs once at deploy.
    pub fn __constructor(env: &Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        extend_instance_ttl(env);
    }

    /// Is `addr` frozen? Defaults to `false`. Refreshes the instance TTL and,
    /// when the address IS frozen, its own entry TTL — so an actively consulted
    /// freeze set (the token gates every movement through here) keeps both the
    /// contract and live freeze entries from silently archiving after 30 days
    /// of admin write-inactivity (M5). Critically, this preserves a freeze:
    /// a frozen entry that lapsed would fail-closed (archived read reverts the
    /// movement) rather than fail-open, but refreshing avoids the outage.
    pub fn is_frozen(env: &Env, addr: Address) -> bool {
        extend_instance_ttl(env);
        let frozen = env
            .storage()
            .persistent()
            .get(&DataKey::Frozen(addr.clone()))
            .unwrap_or(false);
        if frozen {
            extend_frozen_ttl(env, &addr);
        }
        frozen
    }

    /// Freeze `addr` with `reason_hash`. Admin-only. Idempotent: a no-op (and no
    /// event) if `addr` is already frozen.
    pub fn freeze(env: &Env, addr: Address, reason_hash: BytesN<32>) {
        require_admin(env);
        let key = DataKey::Frozen(addr.clone());
        if env.storage().persistent().get(&key).unwrap_or(false) {
            return;
        }
        env.storage().persistent().set(&key, &true);
        extend_frozen_ttl(env, &addr);
        FreezeAdded { addr, reason_hash }.publish(env);
    }

    /// Unfreeze `addr` with `reason_hash`. Admin-only. Idempotent: a no-op (and
    /// no event) if `addr` is not currently frozen.
    pub fn unfreeze(env: &Env, addr: Address, reason_hash: BytesN<32>) {
        require_admin(env);
        let key = DataKey::Frozen(addr.clone());
        if !env.storage().persistent().get(&key).unwrap_or(false) {
            return;
        }
        env.storage().persistent().remove(&key);
        FreezeRemoved { addr, reason_hash }.publish(env);
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
