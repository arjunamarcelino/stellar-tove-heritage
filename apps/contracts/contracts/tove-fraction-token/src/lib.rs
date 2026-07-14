#![no_std]
//! # FractionToken (TOV-147, FR-04.13)
//!
//! Upgradeable per-artwork fraction token skeleton, built on the audited
//! OpenZeppelin `stellar-tokens` fungible base (SEP-41 surface).
//!
//! ## Architecture (spec term → Soroban mapping, binding for TOV-150/151)
//! - *proxy address* → this contract's address (permanent; one per artwork).
//! - *implementation address* → the executable WASM hash, swapped in-place via
//!   `upgrade(new_wasm_hash)` (`update_current_contract_wasm`) — storage
//!   survives, the constructor never re-runs, and the address never changes.
//! - *invariant preflight* → write-once economic params (compile-time
//!   constants, no setter) + the schema-versioned `migrate` gate that reverts
//!   with `Error::InvariantViolated` on an incompatible executable.
//!
//! ## Skeleton, not the full token
//! This crate ships the storage layout (all downstream seams), the SEP-41
//! surface with every movement entrypoint funneled through `guard_movement`
//! (a documented pass-through for TOV-138/139/140), one-shot minter-gated
//! `mint_settle`, and the admin-gated upgrade seam. KYC/freeze/lockup guards,
//! `settle_trade`, and the full upgrade/invariant flow land in follow-up
//! tickets without touching this API surface.
//!
//! ## Admin model
//! `proxy_admin` is a single `Address`; `require_auth` on it works for a
//! plain key now and a multi-sig account later. Non-admin calls fail host
//! authorization (the acceptance-criteria `AUTH_INVALID` case).

#[cfg(feature = "contract")]
mod contract;
mod error;
#[cfg(feature = "contract")]
mod events;
mod storage;

#[cfg(feature = "contract")]
pub use contract::{
    FractionToken, FractionTokenClient, CURRENT_SCHEMA_VERSION, PLATFORM_FEE_BPS, ROYALTY_BPS,
};
pub use error::Error;
#[cfg(feature = "contract")]
pub use storage::InvariantSnapshot;
pub use storage::TokenInit;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_sep41;
