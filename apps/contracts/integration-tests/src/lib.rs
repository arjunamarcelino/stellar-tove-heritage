//! Integration-test-only crate (U5). All content lives in `tests/`.
//!
//! Intentionally an empty rlib: it exists so `tests/wallet_flow.rs` can link
//! the contract crates natively (no mocks) without adding a WASM artifact to
//! `stellar contract build` output.
