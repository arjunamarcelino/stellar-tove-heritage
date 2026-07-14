use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, IntoVal, Val, Vec};
use tove_fraction_token::TokenInit;

use crate::error::Error;
use crate::events::{FactoryDeployed, WasmHashUpdated};
use crate::storage::{extend_instance_ttl, extend_token_ttl, DataKey};

#[contract]
pub struct FractionTokenFactory;

#[contractimpl]
impl FractionTokenFactory {
    /// Bind the factory to its `admin` and the canonical FractionToken
    /// implementation `wasm_hash` (TOV-146). Runs once at deploy. The WASM
    /// behind `wasm_hash` must already be installed on-ledger before the
    /// first `deploy` (the upload pipeline is off-chain/backend).
    pub fn __constructor(env: &Env, admin: Address, wasm_hash: BytesN<32>) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
        extend_instance_ttl(env);
    }

    /// Deploy the FractionToken for `init.artwork_id` at the deterministic
    /// address derived from (factory address, salt = `artwork_id`). Admin-only.
    ///
    /// Fail-first ordering (test-pinned):
    /// 1. `admin.require_auth()` — host auth failure fires FIRST.
    /// 2. registry hit → [`Error::ArtworkAlreadyDeployed`] (exactly one token
    ///    per artwork, the registry entry is never overwritten).
    ///
    /// The caller-supplied `init.impl_wasm_hash` is IGNORED: it is overridden
    /// with the stored canonical hash, which is also the executable actually
    /// instantiated — there is no non-canonical deploy path. Emits
    /// `factory.deployed(artwork_id, token; wasm_hash)` and records the token
    /// in the registry (`token_of`).
    pub fn deploy(env: &Env, init: TokenInit) -> Result<Address, Error> {
        require_admin(env);

        let artwork_id = init.artwork_id.clone();
        let key = DataKey::Token(artwork_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::ArtworkAlreadyDeployed);
        }

        let canonical: BytesN<32> = env.storage().instance().get(&DataKey::WasmHash).unwrap();

        // Enforce the canonical executable (TOV-146): whatever hash the
        // caller put in `init`, the token records — and runs — the canonical.
        let mut init = init;
        init.impl_wasm_hash = canonical.clone();

        // Single-struct constructor: the token's `__constructor(init)` takes
        // one `TokenInit`, so the args vec is one Val (IntoVal mechanism
        // proven by the wallet factory; in-Env equivalent of
        // `env.register(FractionToken, (init,))`).
        let constructor_args: Vec<Val> = vec![env, init.into_val(env)];

        let token = env
            .deployer()
            .with_address(env.current_contract_address(), artwork_id.clone())
            .deploy_v2(canonical.clone(), constructor_args);

        env.storage().persistent().set(&key, &token);
        extend_token_ttl(env, &artwork_id);
        FactoryDeployed { artwork_id, token: token.clone(), wasm_hash: canonical }.publish(env);
        extend_instance_ttl(env);
        Ok(token)
    }

    /// Registry read for the backend (FR-04.13): the deployed token address for
    /// `artwork_id`, or `None`. Refreshes the instance TTL and, when the artwork
    /// IS deployed, that registry entry's TTL — so this permanent
    /// artwork→token mapping (and the settler's canonical-token resolution,
    /// TOV-179) does not archive 30 days after the one-time deploy (M5).
    pub fn token_of(env: &Env, artwork_id: BytesN<32>) -> Option<Address> {
        extend_instance_ttl(env);
        let token = env
            .storage()
            .persistent()
            .get(&DataKey::Token(artwork_id.clone()));
        if token.is_some() {
            extend_token_ttl(env, &artwork_id);
        }
        token
    }

    /// The active canonical FractionToken implementation WASM hash.
    pub fn wasm_hash(env: &Env) -> BytesN<32> {
        extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::WasmHash).unwrap()
    }

    /// Rotate the canonical implementation hash (new audited build, TOV-146).
    /// Admin-only. Affects FUTURE deploys only — already-deployed tokens
    /// upgrade themselves via their own admin-gated `upgrade` seam. Emits
    /// `wasm_hash.updated(old, new)`.
    pub fn set_wasm_hash(env: &Env, new_wasm_hash: BytesN<32>) {
        require_admin(env);
        let old_wasm_hash: BytesN<32> =
            env.storage().instance().get(&DataKey::WasmHash).unwrap();
        env.storage().instance().set(&DataKey::WasmHash, &new_wasm_hash);
        WasmHashUpdated { old_wasm_hash, new_wasm_hash }.publish(env);
        extend_instance_ttl(env);
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
