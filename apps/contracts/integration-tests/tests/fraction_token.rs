//! U4 (TOV-147) — cross-contract proof: a ToveSmartWallet holds FractionToken.
//!
//! One in-process `Env` hosts the REAL stack from `wallet_flow.rs` — factory
//! deploys the real wallet WASM, whose signer delegates to the REAL WebAuthn
//! verifier running the host's genuine secp256r1 verification — plus the
//! FractionToken. The wallet receives the one-shot `mint_settle` distribution
//! and then MOVES fractions under enforcing auth (`env.set_auths`) with a
//! hand-built `SorobanAuthorizationEntry` carrying a genuine p256 passkey
//! signature. No auth mocking anywhere on the passkey flow; `mock_all_auths`
//! appears only for the minter/proxy-admin legs (plain test Addresses whose
//! auth model is unit-covered in the token crate) and is switched off by the
//! subsequent `set_auths`.
//!
//! Signing model (pinned by wallet_flow.rs): signers authenticate
//! `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`,
//! and the WebAuthn clientDataJSON challenge is the 43-char base64url of that
//! digest. The signature payload is reconstructed from
//! `HashIdPreimage::SorobanAuthorization` over the token-`transfer`
//! invocation — this time rooted at the TOKEN contract (the wallet is the
//! authorizing `from` party), the exact shape TOV-144 wallets sign in
//! production.
//!
//! Upgrade leg (R1/AE1, integration variant): after real holdings exist and a
//! real passkey transfer has run, the executable is swapped in place via
//! `upgrade(new_wasm_hash)` — the token keeps its address, and the wallet's
//! balance, the SEP-41 metadata, and every write-once parameter survive; the
//! wallet can still move fractions with a fresh passkey signature under the
//! NEW executable.

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
    Address, Bytes, BytesN, Env, Map, MuxedAddress, String, Val, Vec,
};
use stellar_accounts::{
    smart_account::{AuthPayload, Signer},
    verifiers::{
        utils::base64_url_encode,
        webauthn::{
            WebAuthnSigData, AUTH_DATA_FLAGS_BE, AUTH_DATA_FLAGS_BS, AUTH_DATA_FLAGS_UP,
            AUTH_DATA_FLAGS_UV,
        },
    },
};
use tove_emergency_freeze::EmergencyFreeze;
use tove_fraction_token::{FractionToken, FractionTokenClient, TokenInit};
use tove_kyc_allowlist::{KycAllowlist, KycAllowlistClient};
use tove_wallet_factory::{FractionWalletFactory, FractionWalletFactoryClient};
use tove_webauthn_verifier::ToveWebauthnVerifier;

/// The REAL wallet artifact the factory deploys on-chain (plain `.wasm`:
/// always produced by `stellar contract build`; the `.optimized.wasm` is a
/// manual artifact rebuilds delete).
mod wallet {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/tove_smart_wallet.wasm"
    );
}

/// The token's own built WASM — a known-valid, different-hash executable for
/// the in-place upgrade leg (same fixture the token's U3 unit tests use).
mod token_wasm {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/tove_fraction_token.wasm"
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

/// One-shot distribution: the wallet's allocation plus a bystander's, so the
/// supply invariant (700 + 300 = 1000) is visible across every scenario.
const WALLET_ALLOCATION: i128 = 700;
const BYSTANDER_ALLOCATION: i128 = 300;
const TOTAL_SUPPLY: i128 = 1_000;

// ---------------------------------------------------------------------------
// Passkey fixture construction (same helpers as wallet_flow.rs)
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
/// `sha256(signature_payload || context_rule_ids.to_xdr())`.
fn auth_digest(e: &Env, signature_payload: &BytesN<32>, rule_ids: &Vec<u32>) -> [u8; 32] {
    let mut preimage = Bytes::from_array(e, &signature_payload.to_array());
    preimage.append(&rule_ids.clone().to_xdr(e));
    e.crypto().sha256(&preimage).to_array()
}

/// Real WebAuthn assertion over `digest32`: clientDataJSON challenge is the
/// 43-char base64url of the digest; signature is low-S p256 ECDSA over
/// `sha256(authenticatorData || sha256(clientDataJSON))`.
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
// Harness: factory + REAL verifier + factory-deployed wallet + token, one Env
// ---------------------------------------------------------------------------

struct Setup<'a> {
    env: Env,
    /// Factory-deployed smart wallet — the token holder under test.
    wallet: Address,
    /// The wallet's configured signer: External(real verifier, user key).
    signer: Signer,
    token: FractionTokenClient<'a>,
    /// Offering-escrow stand-in: the only address allowed to `mint_settle`.
    minter: Address,
    proxy_admin: Address,
    artwork_id: BytesN<32>,
    /// REAL KYC allowlist the token consults on every movement (TOV-140).
    kyc: KycAllowlistClient<'a>,
    /// MarketplaceSettler stand-in (plain Address) stored in the token —
    /// `settle_trade`'s caller gate (TOV-143).
    settler: Address,
    /// Platform-fee destination of the settlement split.
    treasury: Address,
    /// Royalty destination of the settlement split.
    artist_payout: Address,
    /// REAL Stellar Asset Contract registered in this Env — the USDC
    /// stand-in `settle_trade` moves via the SDK token client (TOV-143).
    usdc: Address,
}

/// Placeholder "implementation hash" recorded at deploy; the real canonical
/// hash is supplied by the factory (TOV-137/146).
fn initial_impl_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

fn setup(salt_byte: u8) -> Setup<'static> {
    let env = Env::default();
    // Real p256 + WASM wallet execution blows the default test budget.
    env.cost_estimate().budget().reset_unlimited();

    // Wallet stack: factory + real verifier + real wallet WASM.
    let wallet_admin = Address::generate(&env);
    let wallet_wasm_hash = env.deployer().upload_contract_wasm(wallet::WASM);
    let factory_id =
        env.register(FractionWalletFactory, (wallet_admin.clone(), wallet_wasm_hash));
    let factory = FractionWalletFactoryClient::new(&env, &factory_id);
    let verifier = env.register(ToveWebauthnVerifier, ());

    let signer = Signer::External(verifier.clone(), key_data_for(&env, &SECRET_USER));
    let signers = vec![&env, signer.clone()];
    let policies = Map::<Address, Val>::new(&env);
    let salt = BytesN::from_array(&env, &[salt_byte; 32]);

    // Deploy is admin-gated (factory H2). Authorize just the deploy, then
    // restore the default (no-auth) posture the passkey flow relies on.
    env.mock_all_auths();
    let wallet = factory.deploy_wallet(&salt, &signers, &policies);
    env.set_auths(&[]);

    // REAL gating contracts (TOV-140) in the SAME Env — the token consults
    // them cross-contract on every movement, so no placeholder addresses.
    let gating_admin = Address::generate(&env);
    let kyc_id = env.register(KycAllowlist, (gating_admin.clone(),));
    let freeze_id = env.register(EmergencyFreeze, (gating_admin.clone(),));
    let kyc = KycAllowlistClient::new(&env, &kyc_id);

    // FractionToken in the SAME Env; minter/admin are plain test Addresses
    // (offering escrow and multi-sig stand-ins, per the U4 plan). The USDC
    // slot points at a REAL SAC registered here (TOV-143): settle_trade
    // drives genuine cross-contract token transfers against it.
    let proxy_admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let settler = Address::generate(&env);
    let treasury = Address::generate(&env);
    let artist_payout = Address::generate(&env);
    let usdc_admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(usdc_admin).address();
    let artwork_id = BytesN::from_array(&env, &[9u8; 32]);
    let init = TokenInit {
        artwork_id: artwork_id.clone(),
        name: String::from_str(&env, "Tove Fraction Artwork 9"),
        symbol: String::from_str(&env, "TOVE9"),
        proxy_admin: proxy_admin.clone(),
        artist: Address::generate(&env),
        artist_payout: artist_payout.clone(),
        treasury: treasury.clone(),
        artist_retention: 100,
        artist_lockup_until: 1_790_000_000,
        treasury_retention: 50,
        treasury_lockup_until: 1_795_000_000,
        kyc_allowlist: kyc_id,
        freeze_set: freeze_id,
        marketplace_settler: settler.clone(),
        minter: minter.clone(),
        usdc: usdc.clone(),
        impl_wasm_hash: initial_impl_hash(&env),
    };
    let token_id = env.register(FractionToken, (init,));
    let token = FractionTokenClient::new(&env, &token_id);

    Setup {
        env,
        wallet,
        signer,
        token,
        minter,
        proxy_admin,
        artwork_id,
        kyc,
        settler,
        treasury,
        artist_payout,
        usdc,
    }
}

/// Whitelist `addr` on the REAL KYC allowlist. The gating admin is a plain
/// test Address, so its auth is mocked HERE ONLY — passkey tests re-enter
/// enforcing mode with their next `set_auths`.
fn allow(s: &Setup, addr: &Address) {
    s.env.mock_all_auths();
    s.kyc.add(addr);
}

/// Run the one-shot distribution: wallet 700, bystander 300. The minter is a
/// plain test Address (its auth ordering is unit-covered in the token crate),
/// so its auth is mocked HERE ONLY; every passkey test switches to enforcing
/// mode with `set_auths` right after. Returns the bystander.
fn mint_to_wallet(s: &Setup) -> Address {
    let bystander = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![
        &s.env,
        (s.wallet.clone(), WALLET_ALLOCATION),
        (bystander.clone(), BYSTANDER_ALLOCATION),
    ];
    s.env.mock_all_auths();
    s.token.mint_settle(&s.minter, &recipients);
    bystander
}

fn mux(addr: &Address) -> MuxedAddress {
    MuxedAddress::from(addr.clone())
}

/// Reconstruct the host's signature payload for a single-entry auth tree over
/// the TOKEN's `transfer(from = wallet, to, amount)` invocation —
/// `sha256(HashIdPreimage::SorobanAuthorization { network_id, nonce,
/// signature_expiration_ledger, invocation })` — then build the
/// `SorobanAuthorizationEntry` carrying a real passkey signature over the
/// smart-account auth digest for that payload. `nonce` must be unique per
/// entry within one Env (the host burns it on use).
fn signed_token_transfer_entry(
    s: &Setup,
    to: &Address,
    amount: i128,
    nonce: i64,
    secret: &[u8; 32],
) -> SorobanAuthorizationEntry {
    let e = &s.env;
    let expiration = e.ledger().sequence() + 100;

    // The trait takes `to: MuxedAddress`; a plain Address destination crosses
    // the host boundary as `ScVal::Address`, which is what the recorded
    // invocation carries.
    let invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: ScAddress::from(&s.token.address),
            function_name: ScSymbol("transfer".try_into().unwrap()),
            args: std::vec![
                ScVal::Address(ScAddress::from(&s.wallet)),
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
    let signatures = AuthPayload {
        signers: map![e, (s.signer.clone(), sig_data)],
        context_rule_ids: rule_ids,
    };

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

// ---------------------------------------------------------------------------
// U4.1 — the smart wallet receives the one-shot mint distribution
// ---------------------------------------------------------------------------

#[test]
fn wallet_receives_mint_settle_distribution() {
    let s = setup(0x10);

    let bystander = mint_to_wallet(&s);

    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION);
    assert_eq!(s.token.balance(&bystander), BYSTANDER_ALLOCATION);
    assert_eq!(s.token.total_supply(), TOTAL_SUPPLY);
    assert!(s.token.is_minted());
}

// ---------------------------------------------------------------------------
// U4.2 — the wallet SPENDS fractions under enforced auth with a genuine
// passkey signature (real verifier, real p256, no mocks on the flow)
// ---------------------------------------------------------------------------

#[test]
fn wallet_transfers_fractions_with_enforced_real_passkey_auth() {
    let s = setup(0x11);
    mint_to_wallet(&s);
    let to = Address::generate(&s.env);
    allow(&s, &to); // KYC gating (TOV-140): destination must be whitelisted

    let entry = signed_token_transfer_entry(&s, &to, 400, 0x0001, &SECRET_USER);
    // Enforcing mode: ONLY this genuinely-signed entry authorizes anything.
    s.env.set_auths(&[entry]);

    s.token.transfer(&s.wallet, &mux(&to), &400);

    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION - 400);
    assert_eq!(s.token.balance(&to), 400);
    assert_eq!(s.token.total_supply(), TOTAL_SUPPLY); // transfer never mints/burns
}

// ---------------------------------------------------------------------------
// U4.3 — an attacker-signed entry (different p256 key) authorizes nothing
// ---------------------------------------------------------------------------

#[test]
fn attacker_signed_entry_moves_nothing() {
    let s = setup(0x12);
    mint_to_wallet(&s);
    let to = Address::generate(&s.env);
    allow(&s, &to); // gating satisfied — the failure below is pure auth

    // Same entry shape, but the signature comes from the attacker's key.
    let entry = signed_token_transfer_entry(&s, &to, 400, 0x0002, &SECRET_ATTACKER);
    s.env.set_auths(&[entry]);

    let res = s.token.try_transfer(&s.wallet, &mux(&to), &400);

    assert!(res.is_err(), "attacker-signed auth entry must not authorize the transfer");
    // Fail closed: balances are untouched.
    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION);
    assert_eq!(s.token.balance(&to), 0);
}

// ---------------------------------------------------------------------------
// U4.4 — argument binding: a genuine signature over one invocation does not
// authorize a different one (amount escalation fails closed)
// ---------------------------------------------------------------------------

#[test]
fn genuine_entry_for_different_amount_does_not_authorize() {
    let s = setup(0x13);
    mint_to_wallet(&s);
    let to = Address::generate(&s.env);
    allow(&s, &to); // gating satisfied — the failure below is pure auth binding

    // Genuinely signed for 100 — the invocation actually attempted asks 500.
    let entry = signed_token_transfer_entry(&s, &to, 100, 0x0003, &SECRET_USER);
    s.env.set_auths(&[entry]);

    let res = s.token.try_transfer(&s.wallet, &mux(&to), &500);

    assert!(res.is_err(), "an auth entry is bound to its exact invocation args");
    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION);
    assert_eq!(s.token.balance(&to), 0);
}

// ---------------------------------------------------------------------------
// U4.5 — R1/AE1 integration variant: in-place executable upgrade preserves
// the wallet's holdings, metadata, and write-once params at the same address,
// and the passkey still authorizes transfers under the NEW executable
// ---------------------------------------------------------------------------

#[test]
fn token_upgrade_preserves_wallet_holdings_and_passkey_spendability() {
    let s = setup(0x14);
    let bystander = mint_to_wallet(&s);
    let to = Address::generate(&s.env);
    allow(&s, &to); // KYC gating (TOV-140)

    // Real state built by a REAL passkey-authorized transfer (scenario-2 flow).
    let entry = signed_token_transfer_entry(&s, &to, 250, 0x0004, &SECRET_USER);
    s.env.set_auths(&[entry]);
    s.token.transfer(&s.wallet, &mux(&to), &250);
    assert_eq!(s.token.balance(&s.wallet), 450);

    // In-place executable swap by proxy_admin (a plain test Address — its
    // auth gating is unit-covered by the token's AE2 tests, so it is mocked
    // here; enforcing mode resumes with the next set_auths).
    let token_address = s.token.address.clone();
    let old_hash = s.token.impl_wasm_hash();
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    assert_ne!(old_hash, new_hash);
    s.env.mock_all_auths();
    s.token.upgrade(&new_hash);
    // TOV-150: upgrade seals all fund movement (MIGRATION_PENDING) until the
    // new executable passes migrate() — the canonical two-step flow.
    s.token.migrate();

    // Same address serves the new executable...
    assert_eq!(s.token.address, token_address);
    assert_eq!(s.token.impl_wasm_hash(), new_hash);

    // ...with the wallet's holdings and the whole supply picture intact...
    assert_eq!(s.token.balance(&s.wallet), 450);
    assert_eq!(s.token.balance(&to), 250);
    assert_eq!(s.token.balance(&bystander), BYSTANDER_ALLOCATION);
    assert_eq!(s.token.total_supply(), TOTAL_SUPPLY);
    assert!(s.token.is_minted());

    // ...and metadata + write-once params readable by the new code.
    assert_eq!(s.token.decimals(), 0);
    assert_eq!(s.token.name(), String::from_str(&s.env, "Tove Fraction Artwork 9"));
    assert_eq!(s.token.symbol(), String::from_str(&s.env, "TOVE9"));
    assert_eq!(s.token.artwork_id(), s.artwork_id);
    assert_eq!(s.token.proxy_admin(), s.proxy_admin);
    assert_eq!(s.token.minter(), s.minter);
    assert_eq!(s.token.royalty_bps(), 150);
    assert_eq!(s.token.platform_fee_bps(), 150);
    assert_eq!(s.token.schema_version(), 1);

    // The wallet's passkey still moves fractions under the NEW executable —
    // enforced auth again (this set_auths also switches mocking back off).
    let entry = signed_token_transfer_entry(&s, &to, 50, 0x0005, &SECRET_USER);
    s.env.set_auths(&[entry]);
    s.token.transfer(&s.wallet, &mux(&to), &50);

    assert_eq!(s.token.balance(&s.wallet), 400);
    assert_eq!(s.token.balance(&to), 300);
}

// ---------------------------------------------------------------------------
// TOV-140 — the passkey flow is KYC-gated by the REAL allowlist: a genuinely
// signed transfer to a non-whitelisted recipient fails closed (#5, balances
// intact); after the gating admin adds the recipient, the SAME passkey-signed
// entry authorizes the SAME transfer, which now succeeds.
// ---------------------------------------------------------------------------

#[test]
fn wallet_passkey_transfer_blocked_by_kyc_then_succeeds_after_add() {
    let s = setup(0x15);
    mint_to_wallet(&s);
    let to = Address::generate(&s.env); // fresh — NOT whitelisted

    let entry = signed_token_transfer_entry(&s, &to, 200, 0x0006, &SECRET_USER);
    s.env.set_auths(&[entry.clone()]);

    // Fails closed with the gating error, not an auth error: the signature is
    // genuine, the recipient just is not whitelisted. Pinned wire shape of a
    // guard_movement panic through a try_ client: Err(Ok(Error(Contract, #5))).
    let res = s.token.try_transfer(&s.wallet, &mux(&to), &200);
    assert_eq!(
        res.err().expect("non-whitelisted recipient must fail the transfer"),
        Ok(soroban_sdk::Error::from_contract_error(5)), // RecipientNotWhitelisted
    );
    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION);
    assert_eq!(s.token.balance(&to), 0);

    // The gating admin whitelists the recipient; the guard trapped BEFORE the
    // wallet's auth ran, so the nonce is unburned and the SAME signed entry
    // still authorizes the SAME transfer (enforcing mode re-entered by
    // set_auths after the mocked admin op).
    allow(&s, &to);
    s.env.set_auths(&[entry]);
    s.token.transfer(&s.wallet, &mux(&to), &200);

    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION - 200);
    assert_eq!(s.token.balance(&to), 200);
    assert_eq!(s.token.total_supply(), TOTAL_SUPPLY);
}

// ---------------------------------------------------------------------------
// TOV-143 — full settle_trade settlement with the WALLET (passkey account) as
// the SELLER: fractions leave the wallet through the settler-gated internal
// path (NO wallet signature on the fraction leg — that is the plan's auth
// model: the MarketplaceSettler verifies the seller's signed intent, TOV-179),
// and the USDC gross lands split three ways, with the seller_net credited to
// the wallet contract itself.
//
// Auth scope, stated honestly: this scenario's subject is the CROSS-CONTRACT
// ECONOMICS (token ↔ real SAC ↔ wallet-as-holder), not passkey auth — the
// settler and buyer are plain test Addresses, so their auths are mocked
// (`mock_all_auths_allowing_non_root_auth`: the buyer's USDC require_auth
// fires in a non-root frame, token → SAC, exactly the auth entry a settler
// backend assembles on-chain). Driving the settle path through a REAL
// passkey-signed settler transaction is TOV-179 scope (MarketplaceSettler).
// ---------------------------------------------------------------------------

#[test]
fn settle_trade_with_wallet_as_seller_splits_usdc_three_ways() {
    let s = setup(0x16);
    mint_to_wallet(&s); // wallet holds 700 fractions
    let buyer = Address::generate(&s.env);
    allow(&s, &buyer); // KYC gating (TOV-140): the buyer receives fractions

    // Fund the buyer with the gross in REAL SAC units (admin mint).
    s.env.mock_all_auths();
    assert_eq!(s.token.marketplace_settler(), s.settler); // stored gate
    StellarAssetClient::new(&s.env, &s.usdc).mint(&buyer, &10_000);

    // Settle: 100 fractions wallet→buyer, 10_000 USDC buyer→(150/150/9_700).
    s.env.mock_all_auths_allowing_non_root_auth();
    s.token.settle_trade(&buyer, &s.wallet, &100, &10_000);

    // Fractions left the wallet without any wallet signature (by design).
    assert_eq!(s.token.balance(&s.wallet), WALLET_ALLOCATION - 100);
    assert_eq!(s.token.balance(&buyer), 100);
    assert_eq!(s.token.total_supply(), TOTAL_SUPPLY);

    // USDC split landed three ways, buyer fully debited; the wallet CONTRACT
    // holds the seller_net (1.5% platform + 1.5% royalty + 97% seller, zero dust).
    let usdc = TokenClient::new(&s.env, &s.usdc);
    assert_eq!(usdc.balance(&s.treasury), 150);
    assert_eq!(usdc.balance(&s.artist_payout), 150);
    assert_eq!(usdc.balance(&s.wallet), 9_700);
    assert_eq!(usdc.balance(&buyer), 0);
}
