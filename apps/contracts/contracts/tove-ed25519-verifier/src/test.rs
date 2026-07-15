#![cfg(test)]

use ed25519_dalek::{Signer as Ed25519Signer, SigningKey};
use soroban_sdk::{Bytes, BytesN, Env, Vec};

use crate::{ToveEd25519Verifier, ToveEd25519VerifierClient};

// Fixed secret so signatures are deterministic across runs (mirrors OZ's own
// ed25519 verifier tests).
const SECRET_KEY: [u8; 32] = [
    157, 97, 177, 157, 239, 253, 90, 96, 186, 132, 74, 244, 146, 236, 44, 196, 68, 73, 197, 105,
    123, 50, 105, 25, 112, 59, 172, 3, 28, 174, 127, 96,
];

struct Setup<'a> {
    env: Env,
    client: ToveEd25519VerifierClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let id = env.register(ToveEd25519Verifier, ());
    let client = ToveEd25519VerifierClient::new(&env, &id);
    Setup { env, client }
}

/// Sign `payload` host-side with `signing_key`, returning (public key, signature).
fn sign(env: &Env, signing_key: &SigningKey, payload: &[u8]) -> (BytesN<32>, BytesN<64>) {
    let key_data = BytesN::<32>::from_array(env, signing_key.verifying_key().as_bytes());
    let sig_data = BytesN::<64>::from_array(env, &signing_key.sign(payload).to_bytes());
    (key_data, sig_data)
}

#[test]
fn valid_signature_verifies() {
    let s = setup();
    let signing_key = SigningKey::from_bytes(&SECRET_KEY);
    let payload = [1u8; 32];
    let (key_data, sig_data) = sign(&s.env, &signing_key, &payload);

    assert!(s.client.verify(&Bytes::from_array(&s.env, &payload), &key_data, &sig_data));
}

#[test]
fn valid_signature_over_empty_payload_verifies() {
    let s = setup();
    let signing_key = SigningKey::from_bytes(&SECRET_KEY);
    let (key_data, sig_data) = sign(&s.env, &signing_key, &[]);

    assert!(s.client.verify(&Bytes::new(&s.env), &key_data, &sig_data));
}

#[test]
fn corrupted_signature_is_rejected() {
    let s = setup();
    let signing_key = SigningKey::from_bytes(&SECRET_KEY);
    let payload = [1u8; 32];

    let mut signature = signing_key.sign(&payload).to_bytes();
    signature[0] ^= 0x01; // Flip one bit.

    let key_data = BytesN::<32>::from_array(&s.env, signing_key.verifying_key().as_bytes());
    let sig_data = BytesN::<64>::from_array(&s.env, &signature);

    // The host aborts with Error(Crypto, InvalidInput); try_verify surfaces it as Err.
    assert!(s
        .client
        .try_verify(&Bytes::from_array(&s.env, &payload), &key_data, &sig_data)
        .is_err());
}

#[test]
fn signature_over_different_payload_is_rejected() {
    let s = setup();
    let signing_key = SigningKey::from_bytes(&SECRET_KEY);
    let (key_data, sig_data) = sign(&s.env, &signing_key, &[1u8; 32]);

    assert!(s
        .client
        .try_verify(&Bytes::from_array(&s.env, &[2u8; 32]), &key_data, &sig_data)
        .is_err());
}

#[test]
fn signature_from_different_key_is_rejected() {
    let s = setup();
    let signing_key = SigningKey::from_bytes(&SECRET_KEY);
    let other_key = SigningKey::from_bytes(&[7u8; 32]);
    let payload = [1u8; 32];

    // Signature from `other_key` checked against `signing_key`'s public key.
    let (key_data, _) = sign(&s.env, &signing_key, &payload);
    let (_, sig_data) = sign(&s.env, &other_key, &payload);

    assert!(s
        .client
        .try_verify(&Bytes::from_array(&s.env, &payload), &key_data, &sig_data)
        .is_err());
}

#[test]
fn canonicalize_key_returns_raw_key_bytes() {
    let s = setup();
    let key_bytes = [42u8; 32];
    let key = BytesN::<32>::from_array(&s.env, &key_bytes);

    let canonical = s.client.canonicalize_key(&key);

    assert_eq!(canonical, Bytes::from_array(&s.env, &key_bytes));
    assert_eq!(canonical.len(), 32);
}

#[test]
fn batch_canonicalize_key_agrees_with_single_and_preserves_order() {
    let s = setup();
    let key1 = BytesN::<32>::from_array(&s.env, &[1u8; 32]);
    let key2 = BytesN::<32>::from_array(&s.env, &[2u8; 32]);
    let key3 = BytesN::<32>::from_array(&s.env, &[3u8; 32]);

    let keys = Vec::from_array(&s.env, [key1.clone(), key2.clone(), key3.clone()]);
    let batch = s.client.batch_canonicalize_key(&keys);

    assert_eq!(batch.len(), 3);
    for (i, key) in [key1, key2, key3].iter().enumerate() {
        assert_eq!(batch.get(i as u32).unwrap(), s.client.canonicalize_key(key));
    }
}
