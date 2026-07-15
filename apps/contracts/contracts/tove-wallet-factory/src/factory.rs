use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, IntoVal, Map, Val, Vec};
use stellar_accounts::smart_account::Signer;

use crate::storage::{extend_instance_ttl, DataKey};

#[contract]
pub struct FractionWalletFactory;

#[contractimpl]
impl FractionWalletFactory {
    /// Bind the factory to its `admin` (the registration relayer / multi-sig, the
    /// only address allowed to deploy) and the canonical wallet `wasm_hash`. Runs
    /// once, atomically, at deploy.
    pub fn __constructor(e: &Env, admin: Address, wasm_hash: BytesN<32>) {
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
        extend_instance_ttl(e);
    }

    /// Deploy a per-user Tove smart wallet from the stored canonical WASM, at a
    /// deterministic address derived from `salt` (e.g. a hash of the user id /
    /// credential id). The wallet is constructed with `signers` (the passkey via
    /// the WebAuthn verifier, plus a recovery key) and `policies`. Returns the
    /// new wallet's address.
    ///
    /// Admin-only (`admin.require_auth()`): only the registration relayer may
    /// deploy. This closes the deterministic-address hijack, malicious-bytecode
    /// deploy, and salt-collision DoS that an arbitrary caller could otherwise
    /// mount — the caller no longer chooses the WASM hash either, so every wallet
    /// runs the audited canonical code.
    pub fn deploy_wallet(
        e: &Env,
        salt: BytesN<32>,
        signers: Vec<Signer>,
        policies: Map<Address, Val>,
    ) -> Address {
        require_admin(e);
        let wasm_hash: BytesN<32> = e.storage().instance().get(&DataKey::WasmHash).unwrap();
        extend_instance_ttl(e);

        let constructor_args: Vec<Val> = vec![e, signers.into_val(e), policies.into_val(e)];
        e.deployer()
            .with_address(e.current_contract_address(), salt)
            .deploy_v2(wasm_hash, constructor_args)
    }

    /// Rotate the canonical wallet WASM hash (e.g. a re-audited build). Admin-only.
    pub fn set_wasm_hash(e: &Env, new_wasm_hash: BytesN<32>) {
        require_admin(e);
        e.storage().instance().set(&DataKey::WasmHash, &new_wasm_hash);
        extend_instance_ttl(e);
    }

    /// Rotate the admin authority. Admin-only.
    pub fn set_admin(e: &Env, new_admin: Address) {
        require_admin(e);
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        extend_instance_ttl(e);
    }

    /// The current deploy authority.
    pub fn admin(e: &Env) -> Address {
        extend_instance_ttl(e);
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// The canonical wallet WASM hash every deploy is pinned to.
    pub fn wasm_hash(e: &Env) -> BytesN<32> {
        extend_instance_ttl(e);
        e.storage().instance().get(&DataKey::WasmHash).unwrap()
    }
}

/// Assert the direct caller is the stored admin (host auth). Reused by every
/// mutating entrypoint.
fn require_admin(e: &Env) {
    let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}
