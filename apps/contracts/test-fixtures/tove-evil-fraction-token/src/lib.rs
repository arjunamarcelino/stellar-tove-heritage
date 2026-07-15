#![no_std]
//! # tove-evil-fraction-token — TEST FIXTURE, NEVER DEPLOY (TOV-151)
//!
//! A deliberately hostile FractionToken executable. The TOV-151 tests
//! `upgrade()` a real token instance INTO this WASM to prove the invariant
//! gate rejects it and that recovery (upgrade back to the canonical WASM +
//! `migrate` against the retained snapshot) restores service with funds
//! untouched. It is built by `stellar contract build` only because the token
//! test suite `contractimport!`s the artifact; nothing may ever upload it to
//! a network (see README.md; recorded for TOV-146).
//!
//! ## What makes it evil
//! - `ROYALTY_BPS = 400` — the wrong economic constant (canonical: 150).
//!   `migrate()` therefore fails its own constant self-check exactly like a
//!   real malicious build that quietly re-tunes the royalty split would.
//! - Unauthenticated attack hooks (`corrupt_supply`,
//!   `shorten_artist_lockup`, `clear_mint_flag`) that overwrite the token's
//!   storage directly — a rogue executable respects no auth model, so
//!   neither do these.
//! - `migrate_skip_constant_check()` — a migrate variant that runs ONLY the
//!   snapshot comparison. It exists because in the full `migrate()` the
//!   (always-failing) constant check masks the snapshot arms: constants are
//!   compile-time, so a single fixture cannot both fail the constant check
//!   and let a snapshot violation surface through `migrate()`. This
//!   entrypoint lets the tests prove each snapshot arm (supply ==, lockups
//!   >=, mint flag ==) trips `InvariantViolated` on its own, honestly,
//!   inside a real hostile executable.
//! - It still exports `upgrade()` (admin-gated, canonical shape): after the
//!   swap THIS code is the installed executable, and the whole recovery
//!   story depends on the admin being able to upgrade back out of it. (A
//!   truly scorched-earth build could omit the export and brick the
//!   contract — that is an availability attack outside the TOV-151 gate's
//!   scope, mitigated by the TOV-146 canonical-hash review before any
//!   upgrade is signed.)
//!
//! ## Storage layout mirroring (why the local enums are the point)
//! `#[contracttype]` enum keys serialize by VARIANT NAME (each empty variant
//! encodes as a 1-element `Vec[Symbol("<name>")]` — soroban-sdk
//! `derive_enum.rs` `map_empty_variant`), and structs serialize as maps
//! keyed by FIELD NAME. Storage identity therefore needs only matching
//! names — not the same Rust type, crate, or even the full variant set. The
//! canonical crate feature-gates its `DataKey`/`InvariantSnapshot` behind
//! `contract` precisely because dependents must not link its entrypoints,
//! so this crate carries local mirrors of the subset it touches. That is
//! also exactly what a real attacker would do: reproduce the layout by
//! name. The mirror includes `TotalSupply` — OpenZeppelin's
//! `FungibleStorageKey::TotalSupply` (instance storage, `i128`) collides by
//! the same rule, which is how `corrupt_supply` overwrites the OZ ledger
//! from a foreign impl (pinned by test: the canonical `total_supply()`
//! reads the corrupted value back after recovery).

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};
use stellar_contract_utils::upgradeable::{self as upgradeable};
use tove_fraction_token::Error;

/// WRONG on purpose — canonical is 500. The whole fixture exists so the
/// TOV-151 gate can reject a real executable carrying this value.
pub const ROYALTY_BPS: u32 = 400;
/// Kept canonical (150) so `migrate()` fails on the royalty constant alone —
/// one precisely attributable violation.
pub const PLATFORM_FEE_BPS: u32 = 150;
/// Same schema as the canonical v1 executable (an evil build that wants to
/// pass the gate would not announce itself via the schema version).
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Local mirror of the canonical storage keys this fixture touches, PLUS the
/// OZ `TotalSupply` collision. Variant names are the entire contract here —
/// they MUST stay byte-identical to `tove-fraction-token`'s `DataKey`
/// variants (and OZ's `FungibleStorageKey::TotalSupply`); see the crate doc.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Canonical `DataKey::ProxyAdmin` — read for the admin gate.
    ProxyAdmin,
    /// Canonical `DataKey::ArtistLockupUntil` — read by the snapshot check,
    /// overwritten by `shorten_artist_lockup`.
    ArtistLockupUntil,
    /// Canonical `DataKey::TreasuryLockupUntil` — read by the snapshot check.
    TreasuryLockupUntil,
    /// Canonical `DataKey::MintDone` — presence-checked by the snapshot
    /// check, removed by `clear_mint_flag`.
    MintDone,
    /// Canonical `DataKey::MigrationPending` — the seal flag.
    MigrationPending,
    /// Canonical `DataKey::InvariantSnapshot` — the pre-incident baseline.
    InvariantSnapshot,
    /// Canonical `DataKey::ImplWasmHash` — kept current by `upgrade` so the
    /// canonical getter stays truthful after recovery.
    ImplWasmHash,
    /// OZ `FungibleStorageKey::TotalSupply` (stellar-tokens, instance
    /// storage, `i128`) — the collision `corrupt_supply` writes through.
    TotalSupply,
    /// Canonical `DataKey::Usdc` (a write-once economic config slot covered by
    /// the canonical `config_digest`) — the slot `corrupt_usdc` repoints to a
    /// fake token, proving the config arm of the invariant gate.
    Usdc,
}

/// Local mirror of the canonical `InvariantSnapshot` struct — field names
/// (the map keys on the wire) byte-identical to the canonical type.
#[contracttype]
#[derive(Clone)]
pub struct InvariantSnapshot {
    pub total_supply: i128,
    pub artist_lockup_until: u64,
    pub treasury_lockup_until: u64,
    pub minted: bool,
    /// Byte-identical to the canonical `config_digest` field so the snapshot the
    /// canonical `upgrade` wrote deserializes cleanly here. This fixture never
    /// recomputes it (it carries no config slots); the canonical `migrate` on
    /// recovery is what re-checks it.
    pub config_digest: BytesN<32>,
}

fn require_proxy_admin(e: &Env) {
    let admin: Address = e.storage().instance().get(&DataKey::ProxyAdmin).unwrap();
    admin.require_auth();
}

fn migration_pending(e: &Env) -> bool {
    e.storage().instance().has(&DataKey::MigrationPending)
}

/// The snapshot-comparison arm, identical logic shape to the canonical
/// `migrate()`: supply ==, lockups >= (never decreased), mint flag ==. On
/// any mismatch → `InvariantViolated` with pending + snapshot retained; on
/// pass → seal lifted, schema stamped (no `migration.completed` event — an
/// evil build slipping through would not be so polite, and the tests never
/// let this arm pass anyway).
fn verify_snapshot_and_complete(e: &Env) -> Result<(), Error> {
    let snapshot: InvariantSnapshot =
        e.storage().instance().get(&DataKey::InvariantSnapshot).unwrap();
    let total_supply: i128 =
        e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
    let artist_lockup_until: u64 =
        e.storage().instance().get(&DataKey::ArtistLockupUntil).unwrap();
    let treasury_lockup_until: u64 =
        e.storage().instance().get(&DataKey::TreasuryLockupUntil).unwrap();
    if total_supply != snapshot.total_supply
        || artist_lockup_until < snapshot.artist_lockup_until
        || treasury_lockup_until < snapshot.treasury_lockup_until
        || e.storage().instance().has(&DataKey::MintDone) != snapshot.minted
    {
        return Err(Error::InvariantViolated);
    }
    e.storage().instance().remove(&DataKey::MigrationPending);
    e.storage().instance().remove(&DataKey::InvariantSnapshot);
    upgradeable::set_schema_version(e, CURRENT_SCHEMA_VERSION);
    Ok(())
}

#[contract]
pub struct EvilFractionToken;

#[contractimpl]
impl EvilFractionToken {
    /// Same logic shape as the canonical `migrate()` — admin gate, constant
    /// self-check, snapshot comparison — but compiled with THIS crate's
    /// constants, so the `ROYALTY_BPS != 150` arm fires first, every time
    /// (AE2). The snapshot arms below it are reachable only through
    /// [`Self::migrate_skip_constant_check`].
    pub fn migrate(e: &Env) -> Result<(), Error> {
        require_proxy_admin(e);
        if migration_pending(e) {
            if ROYALTY_BPS != 150 || PLATFORM_FEE_BPS != 150 {
                return Err(Error::InvariantViolated);
            }
            return verify_snapshot_and_complete(e);
        }
        if upgradeable::get_schema_version(e) == CURRENT_SCHEMA_VERSION {
            Ok(())
        } else {
            Err(Error::InvariantViolated)
        }
    }

    /// The snapshot comparison ONLY — the constant self-check is skipped, as
    /// a dishonest migrate would. Exists so the tests can prove each
    /// snapshot invariant arm (supply ==, lockups >=, mint flag ==) rejects
    /// tampered state on its own; see the crate doc for why one fixture
    /// cannot demonstrate that through `migrate()`.
    pub fn migrate_skip_constant_check(e: &Env) -> Result<(), Error> {
        require_proxy_admin(e);
        if migration_pending(e) {
            return verify_snapshot_and_complete(e);
        }
        Ok(())
    }

    /// Canonical-shaped upgrade (admin-gated, keeps the first snapshot when
    /// already pending, records the hash) — the recovery escape hatch out of
    /// this executable. No `proxy.upgraded` event: this build is not honest.
    pub fn upgrade(e: &Env, new_wasm_hash: BytesN<32>) {
        require_proxy_admin(e);
        if !migration_pending(e) {
            // Unreachable in the TOV-151 flows (this executable only ever
            // runs while pending), kept for shape-faithfulness: a fresh
            // upgrade would re-seal and re-snapshot here.
            let snapshot = InvariantSnapshot {
                total_supply: e
                    .storage()
                    .instance()
                    .get(&DataKey::TotalSupply)
                    .unwrap_or(0),
                artist_lockup_until: e
                    .storage()
                    .instance()
                    .get(&DataKey::ArtistLockupUntil)
                    .unwrap(),
                treasury_lockup_until: e
                    .storage()
                    .instance()
                    .get(&DataKey::TreasuryLockupUntil)
                    .unwrap(),
                minted: e.storage().instance().has(&DataKey::MintDone),
                // Dead branch (this executable only ever runs while pending, so
                // the re-snapshot never fires); a zero digest keeps the struct
                // shape valid. The real fingerprint is written by the canonical
                // `upgrade` before the swap into this fixture.
                config_digest: BytesN::from_array(e, &[0u8; 32]),
            };
            e.storage().instance().set(&DataKey::InvariantSnapshot, &snapshot);
            e.storage().instance().set(&DataKey::MigrationPending, &true);
        }
        upgradeable::upgrade(e, &new_wasm_hash);
        e.storage().instance().set(&DataKey::ImplWasmHash, &new_wasm_hash);
    }

    /// Proof-of-installation getter: 400, not the canonical 500.
    pub fn royalty_bps(_e: &Env) -> u32 {
        ROYALTY_BPS
    }

    // ── Attack hooks — unauthenticated by design (see crate doc) ────────────

    /// Overwrite the OZ total supply (instance `TotalSupply` slot) with an
    /// arbitrary value — the AE3 supply-invariant violation.
    pub fn corrupt_supply(e: &Env, new_supply: i128) {
        e.storage().instance().set(&DataKey::TotalSupply, &new_supply);
    }

    /// Cut the artist lockup short — the lockup-monotonicity violation.
    pub fn shorten_artist_lockup(e: &Env, new_until: u64) {
        e.storage().instance().set(&DataKey::ArtistLockupUntil, &new_until);
    }

    /// Repoint the write-once `Usdc` slot to an attacker token — a supply-
    /// preserving config corruption. The canonical `config_digest` arm of the
    /// invariant gate must reject this on recovery.
    pub fn corrupt_usdc(e: &Env, fake_usdc: Address) {
        e.storage().instance().set(&DataKey::Usdc, &fake_usdc);
    }

    /// Erase the one-shot mint flag — would re-arm `mint_settle` for a
    /// second inflationary distribution; the mint-flag invariant violation.
    pub fn clear_mint_flag(e: &Env) {
        e.storage().instance().remove(&DataKey::MintDone);
    }
}
