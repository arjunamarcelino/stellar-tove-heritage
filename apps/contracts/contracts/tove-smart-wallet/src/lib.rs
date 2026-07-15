#![no_std]
//! # Tove Smart Wallet (TOV-38)
//!
//! Canonical Soroban smart wallet for Tove Heritage, built on the audited
//! OpenZeppelin `stellar-accounts` smart-account framework. Account-abstraction
//! style: holds USDC + fraction tokens; authorizes moves only via its configured
//! signers (a passkey via the WebAuthn/secp256r1 verifier, plus a recovery key)
//! and policies. One canonical WASM, reused across all users via the factory.
//!
//! - `__check_auth` delegates to `smart_account::do_check_auth` — OZ performs the
//!   secp256r1/WebAuthn verification (no hand-rolled crypto). A failed passkey
//!   check surfaces as `SmartAccountError::ExternalVerificationFailed` (the
//!   on-chain form of the acceptance-criteria `AUTH_INVALID`).
//! - Signers/policies are set at construction (the schema the backend, TOV-21,
//!   builds against) and managed afterwards via the `SmartAccount` entrypoints.

mod contract;
mod events;

pub use contract::{ToveSmartWallet, ToveSmartWalletClient};

#[cfg(test)]
mod test;

// TOV-22 interop: the exact passkey `AuthPayload` the backend relayer must build,
// proven end-to-end against the real WebAuthn verifier and pinned as a golden
// vector so the contract and backend encodings cannot silently drift.
#[cfg(test)]
mod golden_vector_test;
