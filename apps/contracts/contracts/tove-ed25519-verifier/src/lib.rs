#![no_std]
//! Ed25519 signature verifier for Tove smart accounts.
//!
//! Reusable, immutable, stateless verifier (deploy once, share across wallets).
//! Useful for a recovery key signer. Thin wrapper over OpenZeppelin
//! `stellar_accounts::verifiers::ed25519`.

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Vec};
use stellar_accounts::verifiers::{ed25519, Verifier};

#[contract]
pub struct ToveEd25519Verifier;

#[contractimpl]
impl Verifier for ToveEd25519Verifier {
    type KeyData = BytesN<32>;
    type SigData = BytesN<64>;

    fn verify(e: &Env, signature_payload: Bytes, key_data: BytesN<32>, sig_data: BytesN<64>) -> bool {
        ed25519::verify(e, &signature_payload, &key_data, &sig_data)
    }

    fn canonicalize_key(e: &Env, key_data: BytesN<32>) -> Bytes {
        ed25519::canonicalize_key(e, &key_data)
    }

    fn batch_canonicalize_key(e: &Env, keys_data: Vec<BytesN<32>>) -> Vec<Bytes> {
        ed25519::batch_canonicalize_key(e, &keys_data)
    }
}

#[cfg(test)]
mod test;
