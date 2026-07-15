//! U5 — AE3 integration proof, no mocks.
//!
//! One in-process `Env` hosts the REAL stack: the factory deploys the real
//! wallet WASM (`target/wasm32v1-none/release/tove_smart_wallet.optimized.wasm`),
//! whose signer delegates to the natively-registered REAL WebAuthn verifier
//! (`tove-webauthn-verifier`), which runs the host's genuine secp256r1
//! verification. Signatures are produced with the `p256` crate — real ECDSA
//! over real digests, exactly as OZ's own webauthn tests do.
//!
//! Signing model (OZ smart-account, pinned by these tests): signers do NOT
//! sign the raw `signature_payload`; they sign
//! `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`
//! (rule-selection downgrade defense). For WebAuthn, the clientDataJSON
//! challenge is the 43-char base64url encoding of that 32-byte auth digest.
//!
//! `__check_auth` is driven two ways:
//! * `env.try_invoke_contract_check_auth` — the soroban-sdk testutils entry
//!   point for unit-driving a custom account's `__check_auth` with a chosen
//!   payload hash (real crypto, real cross-contract verifier call).
//! * Full enforced-auth flow: `env.set_auths` with a hand-built
//!   `SorobanAuthorizationEntry` whose signature payload we reconstruct from
//!   `HashIdPreimage::SorobanAuthorization`, then a real `wallet.transfer`
//!   moving SAC tokens — the strongest end-to-end form of AE3.

extern crate std;

use p256::{
    ecdsa::{
        signature::hazmat::PrehashSigner, Signature as Secp256r1Signature,
        SigningKey as Secp256r1SigningKey,
    },
    elliptic_curve::sec1::ToEncodedPoint,
    SecretKey as Secp256r1SecretKey,
};
use soroban_sdk::{
    auth::{Context, ContractContext},
    map,
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    vec,
    xdr::{
        Hash as XdrHash, HashIdPreimage, HashIdPreimageSorobanAuthorization, Int128Parts,
        InvokeContractArgs, Limits, ReadXdr, ScAddress, ScSymbol, ScVal,
        SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation, SorobanCredentials, ToXdr, WriteXdr,
    },
    Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
use stellar_accounts::{
    smart_account::{AuthPayload, Signer, SmartAccountError},
    verifiers::{
        utils::base64_url_encode,
        webauthn::{
            WebAuthnSigData, AUTH_DATA_FLAGS_BE, AUTH_DATA_FLAGS_BS, AUTH_DATA_FLAGS_UP,
            AUTH_DATA_FLAGS_UV,
        },
    },
};
use tove_wallet_factory::{FractionWalletFactory, FractionWalletFactoryClient};
use tove_webauthn_verifier::ToveWebauthnVerifier;

/// The REAL wallet artifact the factory deploys on-chain. Uses the plain
/// `.wasm` (always produced by `stellar contract build`) rather than the
/// `.optimized.wasm`, which only exists after a manual `stellar contract
/// optimize` run and is deleted by rebuilds.
mod wallet {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/tove_smart_wallet.wasm"
    );
}

/// Passkey secret bound to the wallet at deploy ("the user's passkey").
const SECRET_USER: [u8; 32] = [
    33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
    56, 57, 58, 59, 60, 61, 62, 63, 64,
];

/// A different, equally valid p256 key ("the attacker's passkey").
const SECRET_ATTACKER: [u8; 32] = [0x42; 32];

const CREDENTIAL_ID: [u8; 16] = [0xC4; 16];

const FLAGS_ALL: u8 =
    AUTH_DATA_FLAGS_UP | AUTH_DATA_FLAGS_UV | AUTH_DATA_FLAGS_BE | AUTH_DATA_FLAGS_BS;

/// The wallet's Default context rule created by `__constructor` gets id 0.
const DEFAULT_RULE_ID: u32 = 0;

// ---------------------------------------------------------------------------
// Passkey fixture construction (mirrors tove-webauthn-verifier/src/test.rs)
// ---------------------------------------------------------------------------

fn keypair(secret: &[u8; 32]) -> (Secp256r1SigningKey, [u8; 65]) {
    let secret_key = Secp256r1SecretKey::from_slice(secret).unwrap();
    let signing_key = Secp256r1SigningKey::from(&secret_key);
    let encoded = secret_key.public_key().to_encoded_point(false);
    let mut pub_key = [0u8; 65];
    pub_key.copy_from_slice(encoded.as_bytes());
    (signing_key, pub_key)
}

/// `key_data` = 65-byte uncompressed SEC1 public key || credential id.
fn key_data_for(e: &Env, secret: &[u8; 32]) -> Bytes {
    let (_, pub_key) = keypair(secret);
    let mut key_data = Bytes::from_array(e, &pub_key);
    key_data.extend_from_array(&CREDENTIAL_ID);
    key_data
}

/// OZ smart-account signing target: signers authenticate
/// `sha256(signature_payload || context_rule_ids.to_xdr())`, NOT the raw
/// payload (binds rule selection into every signature).
fn auth_digest(e: &Env, signature_payload: &BytesN<32>, rule_ids: &Vec<u32>) -> [u8; 32] {
    let mut preimage = Bytes::from_array(e, &signature_payload.to_array());
    preimage.append(&rule_ids.clone().to_xdr(e));
    e.crypto().sha256(&preimage).to_array()
}

/// Real WebAuthn assertion over `digest32`: clientDataJSON challenge is the
/// 43-char base64url of the digest; signature is low-S p256 ECDSA over
/// `sha256(authenticatorData || sha256(clientDataJSON))`. Returns the
/// XDR-encoded `WebAuthnSigData` the verifier expects as `sig_data`.
fn webauthn_sig_data(e: &Env, secret: &[u8; 32], digest32: &[u8; 32]) -> Bytes {
    let (signing_key, _) = keypair(secret);

    let mut challenge = [0u8; 43];
    base64_url_encode(&mut challenge, digest32);
    let challenge = std::str::from_utf8(&challenge).unwrap();

    let client_data = std::format!(
        r#"{{"type":"webauthn.get","challenge":"{challenge}","origin":"https://tove.example","crossOrigin":false}}"#
    );
    let client_data = Bytes::from_slice(e, client_data.as_bytes());

    // 37-byte authenticatorData: 32-byte rpIdHash || flags || 4-byte counter.
    let mut auth_data = [0u8; 37];
    auth_data[32] = FLAGS_ALL;
    let authenticator_data = Bytes::from_array(e, &auth_data);

    // digest = sha256(authenticatorData || sha256(clientDataJSON))
    let mut msg = authenticator_data.clone();
    msg.extend_from_array(&e.crypto().sha256(&client_data).to_array());
    let digest = e.crypto().sha256(&msg);

    let raw: Secp256r1Signature = signing_key.sign_prehash(&digest.to_array()).unwrap();
    let low = raw.normalize_s().unwrap_or(raw);
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&low.to_bytes());

    WebAuthnSigData {
        signature: BytesN::<64>::from_array(e, &sig_bytes),
        authenticator_data,
        client_data,
    }
    .to_xdr(e)
}

// ---------------------------------------------------------------------------
// Harness: factory + REAL verifier + factory-deployed wallet, one Env
// ---------------------------------------------------------------------------

struct Setup<'a> {
    env: Env,
    factory: FractionWalletFactoryClient<'a>,
    wallet: Address,
    /// The wallet's configured signer: External(real verifier, user key).
    signer: Signer,
}

fn setup(salt_byte: u8) -> Setup<'static> {
    let env = Env::default();
    // Real p256 + WASM wallet execution blows the default test budget.
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let wasm_hash = env.deployer().upload_contract_wasm(wallet::WASM);
    let factory_id = env.register(FractionWalletFactory, (admin.clone(), wasm_hash));
    let factory = FractionWalletFactoryClient::new(&env, &factory_id);
    let verifier = env.register(ToveWebauthnVerifier, ());

    let signer = Signer::External(verifier.clone(), key_data_for(&env, &SECRET_USER));
    let signers = vec![&env, signer.clone()];
    let policies = Map::<Address, Val>::new(&env);
    let salt = BytesN::from_array(&env, &[salt_byte; 32]);

    // Deploy is admin-gated (factory H2). Authorize just the deploy, then
    // restore the default (no-auth) posture — the passkey flow below is driven
    // via try_invoke_contract_check_auth / set_auths, never a global mock.
    env.mock_all_auths();
    let wallet = factory.deploy_wallet(&salt, &signers, &policies);
    env.set_auths(&[]);

    Setup { env, factory, wallet, signer }
}

/// A plausible auth context: the wallet authorizing its own `transfer`.
/// The constructor's rule is `ContextRuleType::Default`, which matches any
/// context, so the exact contents only need to be consistent.
fn transfer_context(e: &Env, wallet: &Address) -> Vec<Context> {
    vec![
        e,
        Context::Contract(ContractContext {
            contract: wallet.clone(),
            fn_name: Symbol::new(e, "transfer"),
            args: vec![e],
        }),
    ]
}

/// Build the wallet's `Signature` type (OZ `AuthPayload`) with one signer.
fn auth_payload(e: &Env, signer: &Signer, sig_data: Bytes, rule_ids: &Vec<u32>) -> AuthPayload {
    AuthPayload {
        signers: map![e, (signer.clone(), sig_data)],
        context_rule_ids: rule_ids.clone(),
    }
}

type CheckAuthResult = Result<(), Result<SmartAccountError, soroban_sdk::InvokeError>>;

/// Drive the factory-deployed wallet's `__check_auth` with a signature over
/// (`payload`, `rule_ids`) produced by `secret`.
fn check_auth(s: &Setup, payload: &BytesN<32>, secret: &[u8; 32]) -> CheckAuthResult {
    let rule_ids = vec![&s.env, DEFAULT_RULE_ID];
    let digest = auth_digest(&s.env, payload, &rule_ids);
    let sig_data = webauthn_sig_data(&s.env, secret, &digest);
    let signatures = auth_payload(&s.env, &s.signer, sig_data, &rule_ids);

    s.env.try_invoke_contract_check_auth::<SmartAccountError>(
        &s.wallet,
        payload,
        signatures.into_val(&s.env),
        &transfer_context(&s.env, &s.wallet),
    )
}

// ---------------------------------------------------------------------------
// U5.1 — AE3 accept: genuine passkey signature passes __check_auth
// ---------------------------------------------------------------------------

#[test]
fn factory_deployed_wallet_accepts_genuine_passkey_signature() {
    let s = setup(1);
    let payload = BytesN::from_array(&s.env, &[7u8; 32]);

    let res = check_auth(&s, &payload, &SECRET_USER);

    assert_eq!(res, Ok(()), "real p256 signature through the REAL verifier must authorize");
}

// ---------------------------------------------------------------------------
// U5.2 — AE3 reject: signature from a different (attacker) key fails closed
// ---------------------------------------------------------------------------

/// Pinned: the wrong-key failure is the host's secp256r1 verification error
/// `Error(Crypto, InvalidInput)` escalating out of the verifier frame — a
/// non-Contract error, surfaced by `try_invoke_contract_check_auth` as
/// `Err(Err(InvokeError::Abort))` (it cannot map to `SmartAccountError`).
#[test]
fn wrong_key_signature_fails_closed() {
    let s = setup(2);
    let payload = BytesN::from_array(&s.env, &[7u8; 32]);

    let res = check_auth(&s, &payload, &SECRET_ATTACKER);

    assert_eq!(res, Err(Err(soroban_sdk::InvokeError::Abort)));
}

// ---------------------------------------------------------------------------
// U5.3 — AE3 reject: genuine signature over a DIFFERENT payload fails closed
// ---------------------------------------------------------------------------

/// Pinned: a valid assertion bound to another payload trips the verifier's
/// WebAuthn challenge check — `WebAuthnError::ChallengeInvalid` (#3114) —
/// which escalates through the wallet frame as `InvokeError::Contract(3114)`.
#[test]
fn signature_over_tampered_payload_fails_closed() {
    let s = setup(3);
    let signed_payload = BytesN::from_array(&s.env, &[7u8; 32]);
    let presented_payload = BytesN::from_array(&s.env, &[0xAB; 32]);

    let rule_ids = vec![&s.env, DEFAULT_RULE_ID];
    // Genuine user signature, but over the digest of a different payload.
    let digest = auth_digest(&s.env, &signed_payload, &rule_ids);
    let sig_data = webauthn_sig_data(&s.env, &SECRET_USER, &digest);
    let signatures = auth_payload(&s.env, &s.signer, sig_data, &rule_ids);

    let res = s.env.try_invoke_contract_check_auth::<SmartAccountError>(
        &s.wallet,
        &presented_payload,
        signatures.into_val(&s.env),
        &transfer_context(&s.env, &s.wallet),
    );

    assert_eq!(res, Err(Err(soroban_sdk::InvokeError::Contract(3114))));
}

// ---------------------------------------------------------------------------
// U5.4 — digest binding: signing the RAW payload (without the rule-id
// binding) is NOT accepted — pins OZ's rule-selection downgrade defense
// ---------------------------------------------------------------------------

#[test]
fn signature_over_raw_payload_without_rule_binding_fails_closed() {
    let s = setup(4);
    let payload = BytesN::from_array(&s.env, &[7u8; 32]);
    let rule_ids = vec![&s.env, DEFAULT_RULE_ID];

    // Sign the raw signature_payload instead of the bound auth digest.
    let sig_data = webauthn_sig_data(&s.env, &SECRET_USER, &payload.to_array());
    let signatures = auth_payload(&s.env, &s.signer, sig_data, &rule_ids);

    let res = s.env.try_invoke_contract_check_auth::<SmartAccountError>(
        &s.wallet,
        &payload,
        signatures.into_val(&s.env),
        &transfer_context(&s.env, &s.wallet),
    );

    // Challenge mismatch again: the wallet verifies against the bound digest.
    assert_eq!(res, Err(Err(soroban_sdk::InvokeError::Contract(3114))));
}

// ---------------------------------------------------------------------------
// U5.5 — deterministic addressing: factory deploy lands on the predicted
// deployer().with_address(factory, salt) address
// ---------------------------------------------------------------------------

#[test]
fn factory_deployed_address_matches_deployer_prediction() {
    let s = setup(5);
    let salt = BytesN::from_array(&s.env, &[5u8; 32]);

    let predicted =
        s.env.deployer().with_address(s.factory.address.clone(), salt).deployed_address();

    assert_eq!(s.wallet, predicted);
    // And the wallet at that address is live with exactly the one passkey signer.
    let rule = wallet::Client::new(&s.env, &s.wallet).get_context_rule(&DEFAULT_RULE_ID);
    assert_eq!(rule.signers.len(), 1);
}

// ---------------------------------------------------------------------------
// U5.6 / U5.7 — full enforced-auth transfer: set_auths + real signature moves
// real SAC tokens; an attacker-signed entry moves nothing
// ---------------------------------------------------------------------------

/// Reconstruct the host's signature payload for a single-entry auth tree:
/// `sha256(HashIdPreimage::SorobanAuthorization { network_id, nonce,
/// signature_expiration_ledger, invocation })`, then build the
/// `SorobanAuthorizationEntry` carrying a real passkey signature over the
/// smart-account auth digest for that payload.
fn signed_transfer_entry(
    s: &Setup,
    token: &Address,
    to: &Address,
    amount: i128,
    secret: &[u8; 32],
) -> SorobanAuthorizationEntry {
    let e = &s.env;
    let nonce: i64 = 0x7053_1E55;
    let expiration = e.ledger().sequence() + 100;

    let invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: ScAddress::from(&s.wallet),
            function_name: ScSymbol("transfer".try_into().unwrap()),
            args: std::vec![
                ScVal::Address(ScAddress::from(token)),
                ScVal::Address(ScAddress::from(to)),
                ScVal::I128(Int128Parts { hi: 0, lo: amount as u64 }),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: Default::default(),
    };

    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: XdrHash(e.ledger().network_id().to_array()),
        nonce,
        signature_expiration_ledger: expiration,
        invocation: invocation.clone(),
    });
    let preimage_xdr = preimage.to_xdr(Limits::none()).unwrap();
    let payload: BytesN<32> =
        e.crypto().sha256(&Bytes::from_slice(e, &preimage_xdr)).to_bytes();

    // Real passkey signature over the smart-account auth digest.
    let rule_ids = vec![e, DEFAULT_RULE_ID];
    let digest = auth_digest(e, &payload, &rule_ids);
    let sig_data = webauthn_sig_data(e, secret, &digest);
    let signatures = auth_payload(e, &s.signer, sig_data, &rule_ids);

    // AuthPayload (host Val) -> ScVal for the credentials' signature slot.
    let sig_xdr_bytes = signatures.to_xdr(e);
    let mut buf = std::vec![0u8; sig_xdr_bytes.len() as usize];
    sig_xdr_bytes.copy_into_slice(&mut buf);
    let signature = ScVal::from_xdr(buf.as_slice(), Limits::none()).unwrap();

    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: ScAddress::from(&s.wallet),
            nonce,
            signature_expiration_ledger: expiration,
            signature,
        }),
        root_invocation: invocation,
    }
}

/// Register a SAC token and mint `amount` to the wallet (admin auth mocked for
/// the mint ONLY; mocking is switched off by the subsequent `set_auths`).
fn fund_wallet(s: &Setup, amount: i128) -> Address {
    let e = &s.env;
    let admin = Address::generate(e);
    let token = e.register_stellar_asset_contract_v2(admin.clone()).address();
    e.mock_all_auths();
    StellarAssetClient::new(e, &token).mint(&s.wallet, &amount);
    token
}

#[test]
fn end_to_end_transfer_with_enforced_real_passkey_auth_moves_tokens() {
    let s = setup(6);
    let token = fund_wallet(&s, 1_000);
    let to = Address::generate(&s.env);

    let entry = signed_transfer_entry(&s, &token, &to, 400, &SECRET_USER);
    // Enforcing mode: ONLY this genuinely-signed entry authorizes anything.
    s.env.set_auths(&[entry]);

    wallet::Client::new(&s.env, &s.wallet).transfer(&token, &to, &400);

    let balance = TokenClient::new(&s.env, &token);
    assert_eq!(balance.balance(&s.wallet), 600);
    assert_eq!(balance.balance(&to), 400);
}

#[test]
fn end_to_end_transfer_with_attacker_signed_entry_moves_nothing() {
    let s = setup(7);
    let token = fund_wallet(&s, 1_000);
    let to = Address::generate(&s.env);

    // Same entry shape, but the signature comes from the attacker's key.
    let entry = signed_transfer_entry(&s, &token, &to, 400, &SECRET_ATTACKER);
    s.env.set_auths(&[entry]);

    let res = wallet::Client::new(&s.env, &s.wallet).try_transfer(&token, &to, &400);

    assert!(res.is_err(), "attacker-signed auth entry must not authorize the transfer");
    // Fail closed: balances are untouched.
    let balance = TokenClient::new(&s.env, &token);
    assert_eq!(balance.balance(&s.wallet), 1_000);
    assert_eq!(balance.balance(&to), 0);
}
