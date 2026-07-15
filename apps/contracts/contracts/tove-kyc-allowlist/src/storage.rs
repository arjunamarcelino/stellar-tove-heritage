use soroban_sdk::{contracttype, Address, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The admin authority. Single Address now; may be a multi-sig account later.
    Admin,
    /// Per-address allowlist flag (persistent so KYC status is not lost).
    Allowed(Address),
}

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn extend_allowed_ttl(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Allowed(addr.clone()), BUMP_THRESHOLD, BUMP_AMOUNT);
}
