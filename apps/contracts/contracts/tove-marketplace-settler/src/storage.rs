use soroban_sdk::{contracttype, BytesN, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Storage keys. `Admin`/`Factory` are instance (write-once at `__constructor`);
/// `Settled` is a persistent one-shot marker so it scales with quote volume
/// without bloating the instance entry and survives upgrades.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The admin authority (upgrade / set_admin). Single Address now; may be a
    /// multi-sig account later — `require_auth` works either way.
    Admin,
    /// The fraction-factory address — the canonical `artwork_id → token`
    /// resolver (`token_of`).
    Factory,
    /// One-shot settlement marker, keyed by `(rfq_id, quote_id)`. Presence =
    /// settled; `accept_quote` for the same pair reverts `QuoteAlreadySettled`.
    Settled(BytesN<32>, BytesN<32>),
}

/// Refresh the instance TTL on every entrypoint (including reads) so the config
/// slots — required to invoke the contract at all — cannot silently archive
/// during a read-only stretch (the M5 refresh-on-read fix).
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

/// Refresh a settlement marker's persistent TTL — called when it is written and
/// on every `is_settled` read that finds it, so a permanent record does not
/// archive under read-only load.
pub fn extend_settled_ttl(env: &Env, rfq_id: &BytesN<32>, quote_id: &BytesN<32>) {
    env.storage().persistent().extend_ttl(
        &DataKey::Settled(rfq_id.clone(), quote_id.clone()),
        BUMP_THRESHOLD,
        BUMP_AMOUNT,
    );
}
