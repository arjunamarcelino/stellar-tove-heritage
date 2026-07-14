use soroban_sdk::{contracttype, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The admin authority. Single Address now; may be a multi-sig account later.
    Admin,
    /// Anchored Merkle root per batch date (persistent; written exactly once).
    Root(u32),
}

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn extend_root_ttl(env: &Env, batch_date: u32) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Root(batch_date), BUMP_THRESHOLD, BUMP_AMOUNT);
}
