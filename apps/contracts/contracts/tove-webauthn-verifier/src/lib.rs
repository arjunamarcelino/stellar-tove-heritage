#![no_std]
//! WebAuthn (secp256r1 passkey) verifier for Tove smart accounts.
//!
//! A reusable, immutable, stateless verifier contract: deployed once and shared
//! by every Tove smart wallet for delegated passkey signature verification.
//! Thin wrapper over OpenZeppelin `stellar_accounts::verifiers::webauthn`.
//!
//! `key_data` = 65-byte uncompressed secp256r1 public key followed by the
//! (variable-length) credential id. `sig_data` = XDR-encoded `WebAuthnSigData`.

use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, xdr::FromXdr, Bytes, BytesN, Env, Vec,
};
use stellar_accounts::verifiers::{
    utils::extract_from_bytes,
    webauthn::{self, WebAuthnSigData},
    Verifier,
};

/// Typed errors for malformed input — replaces bare `.expect()` string panics so
/// clients/tooling can tell a malformed key from a malformed signature blob.
/// Behavior is unchanged (both still fail-closed / reject).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `sig_data` did not decode as XDR `WebAuthnSigData`.
    SigDataInvalid = 1,
    /// `key_data` was shorter than the 65-byte SEC1 public key.
    KeyDataInvalid = 2,
}

#[contract]
pub struct ToveWebauthnVerifier;

#[contractimpl]
impl Verifier for ToveWebauthnVerifier {
    type KeyData = Bytes;
    type SigData = Bytes;

    fn verify(e: &Env, signature_payload: Bytes, key_data: Bytes, sig_data: Bytes) -> bool {
        let sig_struct = WebAuthnSigData::from_xdr(e, &sig_data)
            .unwrap_or_else(|_| panic_with_error!(e, Error::SigDataInvalid));
        let pub_key: BytesN<65> = extract_from_bytes(e, &key_data, 0..65)
            .unwrap_or_else(|| panic_with_error!(e, Error::KeyDataInvalid));
        webauthn::verify(e, &signature_payload, &pub_key, &sig_struct)
    }

    fn canonicalize_key(e: &Env, key_data: Bytes) -> Bytes {
        webauthn::canonicalize_key(e, &key_data)
    }

    fn batch_canonicalize_key(e: &Env, keys_data: Vec<Bytes>) -> Vec<Bytes> {
        webauthn::batch_canonicalize_key(e, &keys_data)
    }
}

#[cfg(test)]
mod test;
