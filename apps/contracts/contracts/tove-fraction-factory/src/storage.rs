use soroban_sdk::{contracttype, BytesN, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Storage keys. Instance carries the two config slots (admin + canonical
/// hash); the per-artwork registry is persistent so it scales with the number
/// of artworks without bloating the instance entry.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The admin authority. Single Address now; may be a multi-sig account later.
    Admin,
    /// Canonical FractionToken implementation WASM hash (TOV-146 enforcement
    /// point) — the ONLY executable `deploy` will instantiate.
    WasmHash,
    /// Registry: artwork_id -> deployed token Address (persistent; written
    /// exactly once per artwork, never overwritten).
    Token(BytesN<32>),
}

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn extend_token_ttl(env: &Env, artwork_id: &BytesN<32>) {
    env.storage().persistent().extend_ttl(
        &DataKey::Token(artwork_id.clone()),
        BUMP_THRESHOLD,
        BUMP_AMOUNT,
    );
}
