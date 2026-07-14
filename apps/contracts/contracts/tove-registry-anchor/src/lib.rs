#![no_std]
//! # RegistryAnchor (TOV-89, FR-07.04)
//!
//! Singleton Soroban contract anchoring the provenance registry: the admin
//! emits one `(merkle_root, batch_date)` event per day for the off-chain
//! indexer, and the anchored root stays readable via `root(batch_date)`.
//!
//! A date can be anchored exactly once — re-emission reverts with
//! `Error::DateAlreadyAnchored` (a typed error, unlike the freeze/kyc silent
//! no-op, so the anchoring backend can distinguish "already done" from "done
//! just now"). `batch_date` is an opaque `u32` key; its format (YYYYMMDD vs
//! epoch-day) is the backend's convention.
//!
//! ## Admin model
//! The admin is a single `Address`. `require_auth` on it works whether that
//! account is a single key (MVP) or a multi-sig account later — no contract
//! change needed. A non-admin call fails the host authorization (the
//! acceptance-criteria `AUTH_INVALID` case).

mod contract;
mod error;
mod events;
mod storage;

pub use contract::{RegistryAnchor, RegistryAnchorClient};
pub use error::Error;

#[cfg(test)]
mod test;
