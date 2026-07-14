#![cfg(test)]
//! Real-passkey-signature suite for the WebAuthn verifier wrapper.
//!
//! Payload construction mirrors OpenZeppelin's own webauthn verifier tests
//! (`stellar_accounts::verifiers::test::webauthn`): a 37-byte
//! authenticatorData with the flags byte at index 32, a clientDataJSON whose
//! challenge is the 43-char base64url encoding of the 32-byte signature
//! payload, and a low-S secp256r1 signature over
//! `sha256(authenticatorData || sha256(clientDataJSON))`.

extern crate std;

use hex_literal::hex;
use p256::{
    ecdsa::{
        signature::hazmat::PrehashSigner, Signature as Secp256r1Signature,
        SigningKey as Secp256r1SigningKey,
    },
    elliptic_curve::{sec1::ToEncodedPoint, PrimeField},
    Scalar, SecretKey as Secp256r1SecretKey,
};
use soroban_sdk::{vec, xdr::ToXdr, Bytes, BytesN, Env};
use stellar_accounts::verifiers::{
    utils::base64_url_encode,
    webauthn::{
        WebAuthnSigData, AUTH_DATA_FLAGS_BE, AUTH_DATA_FLAGS_BS, AUTH_DATA_FLAGS_UP,
        AUTH_DATA_FLAGS_UV,
    },
};

use crate::{ToveWebauthnVerifier, ToveWebauthnVerifierClient};

/// 32-byte signature payload (same value OZ uses in its webauthn tests).
const PAYLOAD: [u8; 32] = hex!("4bb7a8b99609b0b8b1d534694bb1f31f129138a2f2a11f8e8702eedbb792922e");

/// Passkey secret used for the "authorized" credential.
const SECRET_A: [u8; 32] = [
    33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
    56, 57, 58, 59, 60, 61, 62, 63, 64,
];

/// A different, equally valid passkey secret (attacker's key).
const SECRET_B: [u8; 32] = [0x42; 32];

/// Variable-length credential id appended to the 65-byte public key.
const CREDENTIAL_ID: [u8; 16] = [0xC4; 16];

const FLAGS_ALL: u8 =
    AUTH_DATA_FLAGS_UP | AUTH_DATA_FLAGS_UV | AUTH_DATA_FLAGS_BE | AUTH_DATA_FLAGS_BS;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct Setup<'a> {
    env: Env,
    client: ToveWebauthnVerifierClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let id = env.register(ToveWebauthnVerifier, ());
    let client = ToveWebauthnVerifierClient::new(&env, &id);
    Setup { env, client }
}

// ---------------------------------------------------------------------------
// Passkey fixture construction (mirrors the OZ webauthn test payloads)
// ---------------------------------------------------------------------------

fn keypair(secret: &[u8; 32]) -> (Secp256r1SigningKey, [u8; 65]) {
    let secret_key = Secp256r1SecretKey::from_slice(secret).unwrap();
    let signing_key = Secp256r1SigningKey::from(&secret_key);
    let encoded = secret_key.public_key().to_encoded_point(false);
    let mut pub_key = [0u8; 65];
    pub_key.copy_from_slice(encoded.as_bytes());
    (signing_key, pub_key)
}

/// 43-char base64url encoding of the 32-byte payload — the WebAuthn challenge.
fn challenge_for(payload: &[u8; 32]) -> std::string::String {
    let mut encoded = [0u8; 43];
    base64_url_encode(&mut encoded, payload);
    std::str::from_utf8(&encoded).unwrap().into()
}

/// 37-byte authenticatorData: 32-byte rpIdHash || flags || 4-byte counter.
fn encode_authenticator_data(e: &Env, flags: u8) -> Bytes {
    let mut data = [0u8; 37];
    data[32] = flags;
    Bytes::from_array(e, &data)
}

fn encode_client_data(e: &Env, challenge: &str) -> Bytes {
    let json = std::format!(
        r#"{{"type":"webauthn.get","challenge":"{challenge}","origin":"https://tove.example","crossOrigin":false}}"#
    );
    Bytes::from_slice(e, json.as_bytes())
}

/// Flip a low-S signature into its (equally valid over the curve, but
/// non-canonical) high-S counterpart: s' = n - s.
fn to_high_s(sig: &Secp256r1Signature) -> Secp256r1Signature {
    let (r, s) = sig.split_scalars();
    let neg_s: Scalar = -*s.as_ref();
    Secp256r1Signature::from_scalars(r.to_repr(), neg_s.to_repr()).unwrap()
}

/// Build (key_data, WebAuthnSigData) signed with `secret` over the given
/// challenge. `high_s` skips low-S normalization (forces the high-S form).
fn build_ex(
    e: &Env,
    challenge: &str,
    secret: &[u8; 32],
    high_s: bool,
) -> (Bytes, WebAuthnSigData) {
    let (signing_key, pub_key) = keypair(secret);

    let client_data = encode_client_data(e, challenge);
    let authenticator_data = encode_authenticator_data(e, FLAGS_ALL);

    // digest = sha256(authenticatorData || sha256(clientDataJSON))
    let mut msg = authenticator_data.clone();
    msg.extend_from_array(&e.crypto().sha256(&client_data).to_array());
    let digest = e.crypto().sha256(&msg);

    let raw: Secp256r1Signature = signing_key.sign_prehash(&digest.to_array()).unwrap();
    let low = raw.normalize_s().unwrap_or(raw);
    let sig = if high_s { to_high_s(&low) } else { low };

    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&sig.to_bytes());
    let signature = BytesN::<64>::from_array(e, &sig_bytes);

    // key_data = 65-byte uncompressed SEC1 public key || credential id
    let mut key_data = Bytes::from_array(e, &pub_key);
    key_data.extend_from_array(&CREDENTIAL_ID);

    (key_data, WebAuthnSigData { signature, authenticator_data, client_data })
}

fn build(e: &Env, payload: &[u8; 32], secret: &[u8; 32]) -> (Bytes, WebAuthnSigData) {
    build_ex(e, &challenge_for(payload), secret, false)
}

// ---------------------------------------------------------------------------
// 1. Happy path: a real passkey signature verifies
// ---------------------------------------------------------------------------

#[test]
fn valid_passkey_signature_verifies() {
    let s = setup();
    let (key_data, sig_struct) = build(&s.env, &PAYLOAD, &SECRET_A);
    let sig_data = sig_struct.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);

    assert!(s.client.verify(&payload, &key_data, &sig_data));
}

// ---------------------------------------------------------------------------
// 2. Tampered signature: flipped bit → host secp256r1 verification fails
//    (pinned: panics with Error(Crypto, InvalidInput), not `false`)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn flipped_signature_bit_is_rejected() {
    let s = setup();
    let (key_data, mut sig_struct) = build(&s.env, &PAYLOAD, &SECRET_A);

    // Flip the lowest bit of the first byte of r.
    let first = sig_struct.signature.get(0).unwrap();
    sig_struct.signature.set(0, first ^ 0x01);

    let sig_data = sig_struct.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);
    s.client.verify(&payload, &key_data, &sig_data);
}

// ---------------------------------------------------------------------------
// 3. Tampered clientDataJSON challenge → ChallengeInvalid (#3114)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #3114)")]
fn tampered_client_data_challenge_is_rejected() {
    let s = setup();

    // Corrupt the first character of the challenge, then produce an otherwise
    // fully valid signature over the corrupted clientDataJSON. Rejection is
    // therefore purely the challenge/payload mismatch, not a broken signature.
    let mut challenge = challenge_for(&PAYLOAD).into_bytes();
    challenge[0] = if challenge[0] == b'A' { b'B' } else { b'A' };
    let challenge = std::string::String::from_utf8(challenge).unwrap();

    let (key_data, sig_struct) = build_ex(&s.env, &challenge, &SECRET_A, false);
    let sig_data = sig_struct.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);
    s.client.verify(&payload, &key_data, &sig_data);
}

#[test]
#[should_panic(expected = "Error(Contract, #3114)")]
fn mismatched_signature_payload_is_rejected() {
    let s = setup();
    let (key_data, sig_struct) = build(&s.env, &PAYLOAD, &SECRET_A);
    let sig_data = sig_struct.to_xdr(&s.env);

    // Valid assertion, but the wallet asks to verify a different payload.
    let other_payload = Bytes::from_array(&s.env, &[0xAB; 32]);
    s.client.verify(&other_payload, &key_data, &sig_data);
}

// ---------------------------------------------------------------------------
// 4. Signature from a different key → rejected
//    (pinned: panics with Error(Crypto, InvalidInput))
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn signature_from_different_key_is_rejected() {
    let s = setup();

    // Assertion signed by attacker key B, presented against credential A.
    let (key_data_a, _) = build(&s.env, &PAYLOAD, &SECRET_A);
    let (_, sig_struct_b) = build(&s.env, &PAYLOAD, &SECRET_B);

    let sig_data = sig_struct_b.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);
    s.client.verify(&payload, &key_data_a, &sig_data);
}

// ---------------------------------------------------------------------------
// 5. High-S (non-normalized) signature → rejected by the host (malleability)
//    (pinned: panics with Error(Crypto, InvalidInput))
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn high_s_signature_is_rejected() {
    let s = setup();
    let (key_data, sig_struct) =
        build_ex(&s.env, &challenge_for(&PAYLOAD), &SECRET_A, /* high_s */ true);
    let sig_data = sig_struct.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);
    s.client.verify(&payload, &key_data, &sig_data);
}

// ---------------------------------------------------------------------------
// 6. Malformed sig_data (not valid WebAuthnSigData XDR) → wrapper expect panic
// ---------------------------------------------------------------------------

#[test]
fn malformed_sig_data_xdr_errors() {
    let s = setup();
    let (key_data, _) = build(&s.env, &PAYLOAD, &SECRET_A);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);

    // Garbage bytes that do not decode as WebAuthnSigData XDR — the wrapper's
    // `.expect()` panics; surfaced through try_verify as Err.
    let garbage = Bytes::from_array(&s.env, &hex!("ffffffffdeadbeef"));
    assert!(s.client.try_verify(&payload, &key_data, &garbage).is_err());

    // Truncated-but-plausible prefix of a real encoding must also fail.
    let (_, sig_struct) = build(&s.env, &PAYLOAD, &SECRET_A);
    let valid_xdr = sig_struct.to_xdr(&s.env);
    let truncated = valid_xdr.slice(0..valid_xdr.len() - 10);
    assert!(s.client.try_verify(&payload, &key_data, &truncated).is_err());
}

// ---------------------------------------------------------------------------
// 7. key_data shorter than 65 bytes → wrapper expect panic
// ---------------------------------------------------------------------------

#[test]
fn short_key_data_errors() {
    let s = setup();
    let (_, sig_struct) = build(&s.env, &PAYLOAD, &SECRET_A);
    let sig_data = sig_struct.to_xdr(&s.env);
    let payload = Bytes::from_array(&s.env, &PAYLOAD);

    // 64 bytes: one short of a SEC1 uncompressed secp256r1 key.
    let short_key = Bytes::from_array(&s.env, &[7u8; 64]);
    assert!(s.client.try_verify(&payload, &short_key, &sig_data).is_err());

    // Empty key_data is the degenerate case of the same panic path.
    let empty_key = Bytes::new(&s.env);
    assert!(s.client.try_verify(&payload, &empty_key, &sig_data).is_err());
}

// ---------------------------------------------------------------------------
// 8. canonicalize_key strips the credential id, returning the bare 65-byte key
// ---------------------------------------------------------------------------

#[test]
fn canonicalize_key_strips_credential_id() {
    let s = setup();
    let (key_data, _) = build(&s.env, &PAYLOAD, &SECRET_A);
    let (_, pub_key) = keypair(&SECRET_A);
    let expected = Bytes::from_array(&s.env, &pub_key);

    let canonical = s.client.canonicalize_key(&key_data);
    assert_eq!(canonical.len(), 65);
    assert_eq!(canonical, expected);

    // Idempotent: canonicalizing an already-bare key is a no-op.
    assert_eq!(s.client.canonicalize_key(&canonical), expected);
}

#[test]
fn canonicalize_key_short_input_errors() {
    let s = setup();
    let short = Bytes::from_array(&s.env, &[1u8; 64]);
    assert!(s.client.try_canonicalize_key(&short).is_err());
}

#[test]
fn batch_canonicalize_key_preserves_order() {
    let s = setup();

    let (key_a, _) = build(&s.env, &PAYLOAD, &SECRET_A);
    let (key_b, _) = build(&s.env, &PAYLOAD, &SECRET_B);
    let (_, pub_a) = keypair(&SECRET_A);
    let (_, pub_b) = keypair(&SECRET_B);

    let canonical = s
        .client
        .batch_canonicalize_key(&vec![&s.env, key_a, key_b]);

    assert_eq!(canonical.len(), 2);
    assert_eq!(canonical.get(0).unwrap(), Bytes::from_array(&s.env, &pub_a));
    assert_eq!(canonical.get(1).unwrap(), Bytes::from_array(&s.env, &pub_b));
}
