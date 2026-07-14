use soroban_sdk::{contracttype, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Instance storage keys: the two config slots (admin + canonical wallet hash).
/// The factory keeps no per-wallet registry — wallet addresses are deterministic
/// from `(factory, salt)` — so the instance entry stays small.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The deploy authority (the registration relayer / multi-sig). Only this
    /// address may deploy a wallet through the factory.
    Admin,
    /// Canonical wallet WASM hash — the ONLY executable `deploy_wallet` will
    /// instantiate. The caller cannot supply a different hash.
    WasmHash,
}

/// Refresh the instance TTL on every entrypoint (including reads) so the config
/// slots — required to invoke the factory at all — cannot silently archive
/// during a long deploy-idle period.
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}
