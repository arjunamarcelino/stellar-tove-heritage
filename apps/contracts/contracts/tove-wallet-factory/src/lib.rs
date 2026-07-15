#![no_std]
//! # FractionWalletFactory (TOV-38)
//!
//! Deploys per-user Tove smart wallets from the single canonical wallet WASM hash,
//! at deterministic addresses derived from a salt. The factory references the
//! audited wallet WASM by hash, so every user shares the same reviewed code.
//!
//! Deploy authority is gated to a constructor-set `admin` (the registration
//! relayer / multi-sig): only the admin may deploy, and the WASM hash is the
//! stored canonical one, not caller-supplied — closing address hijack,
//! malicious-bytecode deploy, and salt-collision DoS by an arbitrary caller.

mod factory;
mod storage;

mod error;

pub use error::Error;
pub use factory::{FractionWalletFactory, FractionWalletFactoryClient};

#[cfg(test)]
mod test;
