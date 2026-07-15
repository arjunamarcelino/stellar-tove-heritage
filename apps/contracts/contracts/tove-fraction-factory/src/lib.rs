#![no_std]
//! # FractionTokenFactory (TOV-137, FR-04.05)
//!
//! Admin-gated singleton factory that births one `FractionToken` per artwork:
//!
//! - `deploy(init)` is restricted to the admin from day one (`require_auth`
//!   family pattern) — a deliberate correction of the wallet factory's still
//!   open deploy authority (TODO TOV-38); FR-04.05 mandates "Owner = admin
//!   multi-sig (deploy restricted)".
//! - The factory is the single enforcement point for the canonical WASM hash
//!   (TOV-146): `deploy` OVERRIDES the caller-supplied `init.impl_wasm_hash`
//!   with the stored canonical hash — there is no non-canonical deploy path.
//!   Hash rotation (post re-audit) is admin-only via `set_wasm_hash` and
//!   emits `wasm_hash.updated(old, new)`.
//! - Deterministic addresses: the deploy salt is `init.artwork_id`, so the
//!   token address is predictable off-chain from (factory address,
//!   artwork_id).
//! - Duplicates are a typed error, not an address collision: the persistent
//!   registry `artwork_id -> Address` is checked before deploying
//!   (`Error::ArtworkAlreadyDeployed`) and doubles as the backend read
//!   (`token_of`, FR-04.13: stable proxy address recorded per Artwork ID).
//!
//! ## Admin model
//! The admin is a single `Address`; `require_auth` on it works for a plain
//! key now and a multi-sig account later. Non-admin calls fail host
//! authorization (the acceptance-criteria `AUTH_INVALID` case).

mod contract;
mod error;
mod events;
mod storage;

pub use contract::{FractionTokenFactory, FractionTokenFactoryClient};
pub use error::Error;

#[cfg(test)]
mod test;
