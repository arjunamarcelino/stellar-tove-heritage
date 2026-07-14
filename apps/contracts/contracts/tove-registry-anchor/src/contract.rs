use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

use crate::error::Error;
use crate::events::RegistryAnchored;
use crate::storage::{extend_instance_ttl, extend_root_ttl, DataKey};

#[contract]
pub struct RegistryAnchor;

#[contractimpl]
impl RegistryAnchor {
    /// Bind the anchor registry to its `admin`. Runs once at deploy.
    pub fn __constructor(env: &Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        extend_instance_ttl(env);
    }

    /// Anchor `merkle_root` for `batch_date`. Admin-only. A date is anchored
    /// exactly once: re-emission fails with `DateAlreadyAnchored` and never
    /// overwrites the stored root.
    pub fn emit(env: &Env, merkle_root: BytesN<32>, batch_date: u32) -> Result<(), Error> {
        require_admin(env);
        let key = DataKey::Root(batch_date);
        if env.storage().persistent().has(&key) {
            return Err(Error::DateAlreadyAnchored);
        }
        env.storage().persistent().set(&key, &merkle_root);
        extend_root_ttl(env, batch_date);
        RegistryAnchored { merkle_root, batch_date }.publish(env);
        Ok(())
    }

    /// The anchored root for `batch_date`, or `None` if not anchored. Refreshes
    /// the instance TTL and, when the date IS anchored, that root's entry TTL —
    /// so a verifier/indexer reading an anchored root keeps this write-once
    /// provenance record (meant to be permanent) from archiving 30 days after
    /// it was written (M5).
    pub fn root(env: &Env, batch_date: u32) -> Option<BytesN<32>> {
        extend_instance_ttl(env);
        let root = env.storage().persistent().get(&DataKey::Root(batch_date));
        if root.is_some() {
            extend_root_ttl(env, batch_date);
        }
        root
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
