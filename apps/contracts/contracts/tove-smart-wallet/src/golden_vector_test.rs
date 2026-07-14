#![cfg(test)]
//! TOV-22 — passkey `AuthPayload` golden vector (contract ⇄ backend interop).
//!
//! The backend relayer (TOV-22) constructs the transaction and must attach the
//! *exact* `AuthPayload` the deployed wallet accepts, or the user's passkey
//! assertion surfaces on-chain as an opaque, fee-burning `AUTH_INVALID`. This
//! test is the single source of truth for that encoding: it drives a *real*
//! secp256r1 passkey signature through the *real* `ToveWebauthnVerifier` and the
//! wallet's `__check_auth`, asserts it is accepted, and pins the resulting bytes.
//!
//! The full chain, confirmed against OpenZeppelin `stellar-accounts` 0.7.2
//! (`smart_account::do_check_auth`, storage.rs):
//!
//! 1. Host hands `__check_auth` a `signature_payload: Hash<32>` (call it
//!    `host_payload`).
//! 2. OZ binds rule selection into the signed digest:
//!    `auth_digest = sha256(host_payload_bytes ‖ context_rule_ids.to_xdr())`.
//! 3. Each `Signer::External(verifier, key_data)` is verified by calling
//!    `verifier.verify(auth_digest, key_data, sig_data)`.
//! 4. For the WebAuthn verifier the passkey signs, in WebAuthn terms:
//!    `challenge = base64url_nopad(auth_digest)`, and the raw secp256r1
//!    signature is over `sha256(authenticatorData ‖ sha256(clientDataJSON))`,
//!    low-S normalized.
//!
//! Run with output to read the vector:
//!   cargo test -p tove-smart-wallet golden_vector -- --nocapture

extern crate std;

use std::string::String;

use p256::{
    ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey},
    elliptic_curve::sec1::ToEncodedPoint,
    SecretKey,
};
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::Address as _,
    vec, xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, Map, Val, Vec,
};
use stellar_accounts::{
    smart_account::{AuthPayload, Signer, SmartAccountError},
    verifiers::utils::base64_url_encode,
};
use tove_webauthn_verifier::ToveWebauthnVerifier;

use crate::ToveSmartWallet;

// ── Fixed inputs — the golden vector is fully deterministic ───────────────────

/// The host `signature_payload` (`Hash<32>`) for this vector. In production this
/// is computed by the host from the auth-entry preimage; here we pin a fixed
/// value so the whole vector reproduces byte-for-byte.
const HOST_PAYLOAD: [u8; 32] = [
    0x4b, 0xb7, 0xa8, 0xb9, 0x96, 0x09, 0xb0, 0xb8, 0xb1, 0xd5, 0x34, 0x69, 0x4b, 0xb1, 0xf3, 0x1f,
    0x12, 0x91, 0x38, 0xa2, 0xf2, 0xa1, 0x1f, 0x8e, 0x87, 0x02, 0xee, 0xdb, 0xb7, 0x92, 0x92, 0x2e,
];

/// The passkey secret (test credential). Deterministic P-256 key → deterministic
/// public key and, via RFC 6979, a deterministic signature.
const SECRET: [u8; 32] = [
    33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
    57, 58, 59, 60, 61, 62, 63, 64,
];

/// Variable-length credential id appended after the 65-byte SEC1 public key in
/// `key_data`. Present verbatim in the on-chain `Signer::External`.
const CREDENTIAL_ID: [u8; 16] = [0xC4; 16];

/// WebAuthn authenticatorData flags (UP|UV|BE|BS) — mirrors the verifier suite.
const FLAGS_ALL: u8 = 0b0000_1101 | 0b0001_0000; // UP(0x01)|UV(0x04)|BE(0x08)|BS(0x10)

/// The single default context rule created by `__constructor` has id 0 (OZ ids
/// come from a monotonic counter starting at 0). A single-context transfer is
/// therefore always `context_rule_ids = [0]`.
const RULE_ID: u32 = 0;

// ── Pinned golden bytes ───────────────────────────────────────────────────────
// Produced by this very test. Any change to the OZ digest construction, the
// `AuthPayload`/`WebAuthnSigData` XDR layout, or the fixed inputs above flips one
// of these — a red CI is the signal that the backend relayer's encoder must be
// re-synced. This is the contract⇄backend anti-drift lock (TOV-22 #4).
const EXPECT_AUTH_DIGEST: &str =
    "6f64dd9fd2a93fb5ea7b5a605c207d410c15f97c1b2e8c2a5a25bd92f795211b";
const EXPECT_CHALLENGE: &str = "b2Tdn9KpP7Xqe1pgXCB9QQwV-XwbLowqWiW9kveVIRs";
const EXPECT_PUBKEY: &str = "041f140146bfb1b251f84f4ddbe0d4cdcfd77afd984a9520e35794021f8312bb9eec995a08b1fa7704df3dcc0b50a9665263fb7711f95f9f8a449c5096e47c892b";
const EXPECT_AUTHPAYLOAD_XDR_B64: &str = "AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAANAAAAUQQfFAFGv7GyUfhPTdvg1M3P13r9mEqVIONXlAIfgxK7nuyZWgix+ncE3z3MC1CpZlJj+3cR+V+fikScUJbkfIkrxMTExMTExMTExMTExMTExAAAAAAAAA0AAAFYAAAAEQAAAAEAAAADAAAADwAAABJhdXRoZW50aWNhdG9yX2RhdGEAAAAAAA0AAAAlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdAAAAAAAAAAAAAA8AAAALY2xpZW50X2RhdGEAAAAADQAAAIV7InR5cGUiOiJ3ZWJhdXRobi5nZXQiLCJjaGFsbGVuZ2UiOiJiMlRkbjlLcFA3WHFlMXBnWENCOVFRd1YtWHdiTG93cVdpVzlrdmVWSVJzIiwib3JpZ2luIjoiaHR0cHM6Ly90b3ZlLmV4YW1wbGUiLCJjcm9zc09yaWdpbiI6ZmFsc2V9AAAAAAAADwAAAAlzaWduYXR1cmUAAAAAAAANAAAAQCNItDSvrHOSPQly0eZ+wJdmJiEyK2JlKy19mlsWIc7pcuTy3tYPbTM923OhIsfwKIPdNnPz7kbRHZ1m5K3ctnM=";

// ── std helpers (test-only) ───────────────────────────────────────────────────

fn hex(bytes: &[u8]) -> String {
    let mut s = String::new();
    for b in bytes {
        s.push_str(&std::format!("{:02x}", b));
    }
    s
}

/// Standard (RFC 4648) base64 with padding — the encoding used for XDR blobs.
fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn to_vec(b: &Bytes) -> std::vec::Vec<u8> {
    b.iter().collect()
}

// ── Passkey fixture construction (mirrors OZ webauthn test payloads) ──────────

fn keypair() -> (SigningKey, [u8; 65]) {
    let sk = SecretKey::from_slice(&SECRET).unwrap();
    let signing_key = SigningKey::from(&sk);
    let encoded = sk.public_key().to_encoded_point(false);
    let mut pub_key = [0u8; 65];
    pub_key.copy_from_slice(encoded.as_bytes());
    (signing_key, pub_key)
}

/// 43-char base64url (no padding) of a 32-byte digest — the WebAuthn challenge.
fn challenge_for(digest: &[u8; 32]) -> String {
    let mut encoded = [0u8; 43];
    base64_url_encode(&mut encoded, digest);
    std::str::from_utf8(&encoded).unwrap().into()
}

/// 37-byte authenticatorData: 32-byte rpIdHash ‖ flags ‖ 4-byte counter.
fn authenticator_data(e: &Env) -> Bytes {
    let mut data = [0u8; 37];
    data[32] = FLAGS_ALL;
    Bytes::from_array(e, &data)
}

fn client_data_json(e: &Env, challenge: &str) -> Bytes {
    let json = std::format!(
        r#"{{"type":"webauthn.get","challenge":"{challenge}","origin":"https://tove.example","crossOrigin":false}}"#
    );
    Bytes::from_slice(e, json.as_bytes())
}

/// The OZ digest the passkey actually signs:
/// `auth_digest = sha256(host_payload ‖ context_rule_ids.to_xdr())`.
fn auth_digest(e: &Env, host_payload: &[u8; 32], rule_ids: &Vec<u32>) -> [u8; 32] {
    let mut preimage = Bytes::from_array(e, host_payload);
    preimage.append(&rule_ids.clone().to_xdr(e));
    e.crypto().sha256(&preimage).to_array()
}

/// Build (`Signer::External`, sig_data XDR bytes) for a passkey assertion over
/// `challenge`, plus the raw parts, for a wallet using `verifier`.
struct Assertion {
    signer: Signer,
    sig_data_xdr: Bytes,
    authenticator_data: Bytes,
    client_data: Bytes,
    signature: [u8; 64],
}

fn sign_assertion(e: &Env, verifier: &Address, challenge: &str) -> Assertion {
    use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

    let (signing_key, pub_key) = keypair();
    let client_data = client_data_json(e, challenge);
    let auth_data = authenticator_data(e);

    // digest = sha256(authenticatorData ‖ sha256(clientDataJSON))
    let mut msg = auth_data.clone();
    msg.extend_from_array(&e.crypto().sha256(&client_data).to_array());
    let digest = e.crypto().sha256(&msg);

    let raw: Signature = signing_key.sign_prehash(&digest.to_array()).unwrap();
    let low = raw.normalize_s().unwrap_or(raw);
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&low.to_bytes());
    let signature = BytesN::<64>::from_array(e, &sig_bytes);

    // key_data = 65-byte uncompressed SEC1 public key ‖ credential id.
    let mut key_data = Bytes::from_array(e, &pub_key);
    key_data.extend_from_array(&CREDENTIAL_ID);

    let sig_struct = WebAuthnSigData {
        signature,
        authenticator_data: auth_data.clone(),
        client_data: client_data.clone(),
    };

    Assertion {
        signer: Signer::External(verifier.clone(), key_data),
        sig_data_xdr: sig_struct.to_xdr(e),
        authenticator_data: auth_data,
        client_data,
        signature: sig_bytes,
    }
}

/// Register the real verifier + a wallet bound to the passkey, and return both.
fn deploy(e: &Env) -> (Address, Address, [u8; 65]) {
    let verifier = e.register(ToveWebauthnVerifier, ());
    let (_, pub_key) = keypair();
    let mut key_data = Bytes::from_array(e, &pub_key);
    key_data.extend_from_array(&CREDENTIAL_ID);
    let signer = Signer::External(verifier.clone(), key_data);
    let signers = vec![e, signer];
    let wallet = e.register(ToveSmartWallet, (signers, Map::<Address, Val>::new(e)));
    (wallet, verifier, pub_key)
}

/// A single transfer context — the Default rule authorizes any context, so its
/// exact contents don't affect acceptance; it just satisfies the 1:1 alignment
/// with `context_rule_ids`.
fn transfer_context(e: &Env, wallet: &Address) -> Vec<Context> {
    let token = Address::generate(e);
    let to = Address::generate(e);
    vec![
        e,
        Context::Contract(ContractContext {
            contract: token,
            fn_name: symbol_short!("transfer"),
            args: (wallet.clone(), to, 100_i128).into_val(e),
        }),
    ]
}

// ── The golden vector ─────────────────────────────────────────────────────────

#[test]
fn golden_vector_passkey_authpayload_is_accepted() {
    let e = Env::default();
    let (wallet, verifier, pub_key) = deploy(&e);

    let rule_ids = vec![&e, RULE_ID];
    let digest = auth_digest(&e, &HOST_PAYLOAD, &rule_ids);
    let challenge = challenge_for(&digest);

    let a = sign_assertion(&e, &verifier, &challenge);

    let mut signers = Map::<Signer, Bytes>::new(&e);
    signers.set(a.signer.clone(), a.sig_data_xdr.clone());
    let auth_payload = AuthPayload { signers, context_rule_ids: rule_ids.clone() };

    let host_payload = BytesN::<32>::from_array(&e, &HOST_PAYLOAD);
    let contexts = transfer_context(&e, &wallet);

    // Drive the wallet's real `__check_auth` → OZ `do_check_auth` → real
    // secp256r1 verification via `ToveWebauthnVerifier`. Must be accepted.
    let res = e.try_invoke_contract_check_auth::<SmartAccountError>(
        &wallet,
        &host_payload,
        auth_payload.clone().into_val(&e),
        &contexts,
    );
    assert_eq!(res, Ok(()), "the golden AuthPayload must be accepted by __check_auth");

    // ── Emit the vector (visible with `-- --nocapture`) ──────────────────────
    let authpayload_xdr = to_vec(&auth_payload.clone().to_xdr(&e));
    let sig_data = to_vec(&a.sig_data_xdr);
    let auth_data = to_vec(&a.authenticator_data);
    let client_data = to_vec(&a.client_data);

    std::println!("──────── TOV-22 passkey AuthPayload golden vector ────────");
    std::println!("host_payload (Hash<32>, hex)  : {}", hex(&HOST_PAYLOAD));
    std::println!("context_rule_ids              : [{}]", RULE_ID);
    std::println!("auth_digest = sha256(hp‖ids)  : {}", hex(&digest));
    std::println!("webauthn challenge (b64url)   : {}", challenge);
    std::println!("pubkey (SEC1 uncompressed,65) : {}", hex(&pub_key));
    std::println!("credential_id (hex)           : {}", hex(&CREDENTIAL_ID));
    std::println!("authenticatorData (hex)       : {}", hex(&auth_data));
    std::println!(
        "clientDataJSON (utf8)         : {}",
        std::str::from_utf8(&client_data).unwrap()
    );
    std::println!("signature r‖s (low-S, hex)    : {}", hex(&a.signature));
    std::println!("WebAuthnSigData XDR (b64)     : {}", b64(&sig_data));
    std::println!("AuthPayload XDR (hex)         : {}", hex(&authpayload_xdr));
    std::println!("AuthPayload XDR (b64)         : {}", b64(&authpayload_xdr));
    std::println!("──────────────────────────────────────────────────────────");

    // Pin the exact bytes so any encoding drift (OZ digest, XDR layout) trips CI
    // and signals the backend relayer's encoder must be re-synced.
    assert_eq!(hex(&digest), EXPECT_AUTH_DIGEST, "auth_digest drifted");
    assert_eq!(challenge, EXPECT_CHALLENGE, "webauthn challenge drifted");
    assert_eq!(hex(&pub_key), EXPECT_PUBKEY, "passkey public key drifted");
    assert_eq!(
        b64(&authpayload_xdr),
        EXPECT_AUTHPAYLOAD_XDR_B64,
        "AuthPayload XDR drifted — backend encoder must be re-synced"
    );
}

/// Canary: the assertion is cryptographically bound to `host_payload ‖ rule_ids`.
/// Presenting the same signature against a *different* host payload must fail —
/// the backend cannot replay a passkey assertion onto another transaction.
#[test]
fn golden_vector_is_bound_to_the_host_payload() {
    let e = Env::default();
    let (wallet, verifier, _) = deploy(&e);

    let rule_ids = vec![&e, RULE_ID];
    let digest = auth_digest(&e, &HOST_PAYLOAD, &rule_ids);
    let a = sign_assertion(&e, &verifier, &challenge_for(&digest));

    let mut signers = Map::<Signer, Bytes>::new(&e);
    signers.set(a.signer, a.sig_data_xdr);
    let auth_payload = AuthPayload { signers, context_rule_ids: rule_ids };

    // Same signatures, but the host asks to authorize a *different* payload.
    let other_payload = BytesN::<32>::from_array(&e, &[0xAB; 32]);
    let contexts = transfer_context(&e, &wallet);

    let res = e.try_invoke_contract_check_auth::<SmartAccountError>(
        &wallet,
        &other_payload,
        auth_payload.into_val(&e),
        &contexts,
    );
    assert!(res.is_err(), "a passkey assertion must not authorize a different payload");
}
