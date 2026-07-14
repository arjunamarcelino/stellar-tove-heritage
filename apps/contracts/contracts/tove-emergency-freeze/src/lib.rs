#![no_std]
//! # EmergencyFreezeSet (TOV-142, FR-04.08b)
//!
//! Singleton Soroban contract holding the set of frozen addresses.
//! `is_frozen(addr)` is a cheap read used by FractionToken transfer gating;
//! `freeze` / `unfreeze` are admin-only and carry a `reason_hash`.
//!
//! Privacy: only the hash of the human-readable reason is stored on-chain; the
//! backend keeps the off-chain mirror of reasons.
//!
//! ## Admin model
//! The admin is a single `Address`. `require_auth` on it works whether that
//! account is a single key (MVP) or a multi-sig account later — no contract
//! change needed. A non-admin call fails the host authorization.

mod contract;
mod events;
mod storage;

pub use contract::{EmergencyFreeze, EmergencyFreezeClient};

#[cfg(test)]
mod test;
