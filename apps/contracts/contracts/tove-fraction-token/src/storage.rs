use soroban_sdk::{contracttype, Address, BytesN, String};
#[cfg(feature = "contract")]
use soroban_sdk::Env;
#[cfg(feature = "contract")]
use stellar_tokens::fungible::{INSTANCE_EXTEND_AMOUNT, INSTANCE_TTL_THRESHOLD};

/// Write-once per-artwork constructor parameters.
///
/// Passed as a single struct because soroban-sdk 26.1.0 implements
/// `ConstructorArgs` for tuples only up to arity 13 (constructor_args.rs) and
/// this token needs 17 per-artwork values. Everything here is set exactly
/// once at deploy; the only post-deploy mutation in the whole config surface
/// is `set_proxy_admin` (admin-gated).
///
/// Notes on individual fields:
/// - `artwork_id`: `BytesN<32>` hash of the canonical Artwork ID — fixed-size,
///   cheap to index, and format-agnostic (the backend owns the hashing
///   convention), rather than an unbounded `String`.
/// - `artist_retention` / `treasury_retention`: `i128` to match the OZ/SEP-41
///   amount type end-to-end (ticket wording said `u128`; deviating avoids
///   lossy casts on every balance comparison in TOV-138/139).
/// - `*_lockup_until`: u64 unix timestamps; enforcement lands in TOV-138/139.
/// - `impl_wasm_hash`: hash of the executable this contract was deployed
///   with — the initial "implementation address" (spec mapping), kept
///   current by `upgrade`.
#[contracttype]
#[derive(Clone)]
pub struct TokenInit {
    pub artwork_id: BytesN<32>,
    pub name: String,
    pub symbol: String,
    pub proxy_admin: Address,
    pub artist: Address,
    pub artist_payout: Address,
    pub treasury: Address,
    pub artist_retention: i128,
    pub artist_lockup_until: u64,
    pub treasury_retention: i128,
    pub treasury_lockup_until: u64,
    pub kyc_allowlist: Address,
    pub freeze_set: Address,
    pub marketplace_settler: Address,
    pub minter: Address,
    pub usdc: Address,
    pub impl_wasm_hash: BytesN<32>,
}

/// Invariant baseline recorded by `upgrade()` BEFORE the executable swap and
/// deleted by a successful `migrate()` (TOV-150). The full comparison of live
/// state against this snapshot is the TOV-151 invariant gate; TOV-150 records
/// it and pins its lifecycle.
///
/// PINNED (security decision): a second `upgrade` while a migration is
/// already pending does NOT overwrite this snapshot — the FIRST snapshot is
/// the pre-incident baseline. If a rogue interim executable mutated state,
/// re-snapshotting would launder the corruption into the new baseline;
/// keeping the first snapshot means recovery (upgrade back to the canonical
/// WASM + migrate) is always judged against the last known-good state.
#[cfg(feature = "contract")]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvariantSnapshot {
    /// `Base::total_supply` at snapshot time.
    pub total_supply: i128,
    /// Stored `ArtistLockupUntil` at snapshot time (must never decrease).
    pub artist_lockup_until: u64,
    /// Stored `TreasuryLockupUntil` at snapshot time (must never decrease).
    pub treasury_lockup_until: u64,
    /// Whether the one-shot `MintDone` flag was present at snapshot time.
    pub minted: bool,
    /// Fingerprint of the WRITE-ONCE economic config slots at snapshot time
    /// (`crate::contract::config_digest`): ArtworkId, Artist, ArtistPayout,
    /// Treasury, MarketplaceSettler, Minter, Usdc, ArtistRetention,
    /// TreasuryRetention, ArtistAbsorbedLeftover. `migrate` re-checks it so a
    /// rogue interim executable cannot repoint any of them (e.g. Usdc → a fake
    /// token, ArtistPayout → an attacker) and still pass the gate. Deliberately
    /// EXCLUDES admin-rotatable slots (ProxyAdmin / KycAllowlist / FreezeSet —
    /// they have setters, so a legitimate admin may change them mid-pending) and
    /// per-holder balances (uncoverable cheaply); those rest on the admin
    /// multi-sig + TOV-146 canonical-hash review.
    pub config_digest: BytesN<32>,
}

/// Instance-storage keys for this contract's own state.
///
/// COLLISION RULE: `#[contracttype]` enum keys serialize by VARIANT NAME
/// string, so the namespace is shared with every library writing to the same
/// storage. The following variant names are therefore forbidden here:
/// `Meta`, `TotalSupply`, `Balance`, `Allowance` (OZ `FungibleStorageKey`,
/// stellar-tokens) and `SchemaVersion` (OZ `UpgradeableStorageKey`,
/// stellar-contract-utils — we use OZ's own get/set helpers for it instead
/// of defining a key).
///
/// All slots are write-once at the constructor except `ProxyAdmin`
/// (admin-gated setter), `ImplWasmHash` (updated by `upgrade`),
/// `MintDone` (set exactly once by `mint_settle`) and
/// `ArtistAbsorbedLeftover` (set at most once by `record_absorbed_leftover`).
#[cfg(feature = "contract")]
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// BytesN<32> hash of the canonical Artwork ID (write-once identity).
    ArtworkId,
    /// Admin authority for upgrade/migrate/set_proxy_admin (multi-sig later).
    ProxyAdmin,
    /// Artist identity address (lockup subject, TOV-138).
    Artist,
    /// Artist payout address (royalty destination, TOV-143).
    ArtistPayout,
    /// Treasury address (retention + platform position, TOV-139).
    Treasury,
    /// Planned artist retention, i128 (lockup floor input, TOV-138).
    ArtistRetention,
    /// Artist lockup expiry, unix seconds (must never decrease — TOV-138).
    ArtistLockupUntil,
    /// Planned treasury retention, i128 (lockup floor input, TOV-139).
    TreasuryRetention,
    /// Treasury lockup expiry, unix seconds (must never decrease — TOV-139).
    TreasuryLockupUntil,
    /// KYCAllowlist contract address (guard target, TOV-140).
    KycAllowlist,
    /// EmergencyFreezeSet contract address (guard target, TOV-140).
    FreezeSet,
    /// MarketplaceSettler address (settle_trade gate, TOV-143).
    MarketplaceSettler,
    /// Offering escrow — the only address allowed to trigger `mint_settle`.
    Minter,
    /// USDC SAC address (fee/royalty legs of settle_trade, TOV-143).
    Usdc,
    /// Current implementation WASM hash (spec: "implementation address").
    ImplWasmHash,
    /// One-shot flag: present once `mint_settle` has run (TOV-151 invariant).
    MintDone,
    /// Absorbed under-subscription leftover added to the artist lockup floor,
    /// i128 (FR-04.06). Set at most ONCE via `record_absorbed_leftover`
    /// (minter-only, pre-mint); absent ⇒ 0. TOV-138 / filled by TOV-159.
    ArtistAbsorbedLeftover,
    /// Flag (presence = pending): set by `upgrade`, removed by a successful
    /// `migrate`. While present, every balance movement is sealed with
    /// [`crate::Error::MigrationPending`]. TOV-150.
    MigrationPending,
    /// [`InvariantSnapshot`] recorded by `upgrade` (first upgrade of a
    /// pending cycle only — see the struct's PINNED note), removed by a
    /// successful `migrate`. TOV-150; compared in full by TOV-151.
    InvariantSnapshot,
}

/// Extend the instance TTL. OZ manages TTL only for its own persistent
/// (Balance) and temporary (Allowance) entries; the instance entry — which
/// carries metadata, total supply, and all our config slots — is explicitly
/// left to the implementor (stellar-tokens fungible/mod.rs). We reuse OZ's
/// exported thresholds so the whole instance rides one policy.
#[cfg(feature = "contract")]
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_EXTEND_AMOUNT);
}
