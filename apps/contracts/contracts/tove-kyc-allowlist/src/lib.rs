#![no_std]
//! # KYCAllowlist (TOV-141, FR-04.08a)
//!
//! Singleton Soroban contract holding the set of KYC-approved addresses.
//! `is_allowed(addr)` is a cheap read used by FractionToken transfer gating;
//! `add` / `remove` are restricted to the admin.
//!
//! ## Admin model
//! The admin is a single `Address`. `require_auth` on it works whether that
//! account is a single key (MVP) or a multi-sig account later — no contract
//! change needed to move from single-key to multi-sig. A non-admin call fails
//! the host authorization (the acceptance-criteria `AUTH_INVALID` case).

mod contract;
mod events;
mod storage;

pub use contract::{KycAllowlist, KycAllowlistClient};

#[cfg(test)]
mod test;
