#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, Error as SdkError, IntoVal, Map, MuxedAddress, String, Symbol,
    Val, Vec,
};
use tove_emergency_freeze::{EmergencyFreeze, EmergencyFreezeClient};
use tove_kyc_allowlist::{KycAllowlist, KycAllowlistClient};

use crate::storage::DataKey;
use crate::{
    Error, FractionToken, FractionTokenClient, InvariantSnapshot, TokenInit,
    CURRENT_SCHEMA_VERSION, PLATFORM_FEE_BPS, ROYALTY_BPS,
};

// The token's own built WASM — a known-valid executable for the upgrade happy
// path (AE1). Built by `stellar contract build` before `cargo test` (same
// arrangement as the smart-wallet upgrade test / CI).
mod token_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/tove_fraction_token.wasm"
    );
}

/// Placeholder "implementation hash" recorded at deploy time; the real
/// canonical hash is supplied by the factory (TOV-137/146).
fn initial_impl_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

// `pub(crate)` on the harness pieces below: the SEP-41 event-conformance
// suite (`test_sep41.rs`, TOV-144) reuses this exact harness — same Env
// wiring, same fixtures — so both suites pin behavior of the identical setup.
pub(crate) struct Setup<'a> {
    pub(crate) env: Env,
    pub(crate) id: Address,
    pub(crate) client: FractionTokenClient<'a>,
    admin: Address,
    artist: Address,
    artist_payout: Address,
    treasury: Address,
    /// Address of the REAL KycAllowlist contract registered in this Env.
    kyc_allowlist: Address,
    /// Address of the REAL EmergencyFreeze contract registered in this Env.
    freeze_set: Address,
    marketplace_settler: Address,
    pub(crate) minter: Address,
    /// Address of a REAL Stellar Asset Contract registered in this Env — the
    /// USDC stand-in `settle_trade` moves via `token::TokenClient` (TOV-143).
    usdc: Address,
    /// SAC admin — mints USDC to buyers via `StellarAssetClient`.
    usdc_admin: Address,
    artwork_id: BytesN<32>,
    /// Admin of both gating contracts (their ops run under mock_all_auths).
    gating_admin: Address,
    kyc: KycAllowlistClient<'a>,
    freeze: EmergencyFreezeClient<'a>,
}

const ARTIST_RETENTION: i128 = 100;
const ARTIST_LOCKUP_UNTIL: u64 = 1_790_000_000;
const TREASURY_RETENTION: i128 = 50;
const TREASURY_LOCKUP_UNTIL: u64 = 1_795_000_000;

pub(crate) fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let artist_payout = Address::generate(&env);
    let treasury = Address::generate(&env);
    // REAL gating contracts (TOV-140): the token consults them cross-contract
    // on every movement, so the harness registers genuine instances — no mocks.
    let gating_admin = Address::generate(&env);
    let kyc_allowlist = env.register(KycAllowlist, (gating_admin.clone(),));
    let freeze_set = env.register(EmergencyFreeze, (gating_admin.clone(),));
    let kyc = KycAllowlistClient::new(&env, &kyc_allowlist);
    let freeze = EmergencyFreezeClient::new(&env, &freeze_set);
    let marketplace_settler = Address::generate(&env);
    let minter = Address::generate(&env);
    // REAL SAC (TOV-143): settle_trade drives its USDC legs through the SDK
    // token client against this address, so the harness registers a genuine
    // Stellar Asset Contract — no placeholder.
    let usdc_admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(usdc_admin.clone()).address();
    let artwork_id = BytesN::from_array(&env, &[7u8; 32]);

    let init = TokenInit {
        artwork_id: artwork_id.clone(),
        name: String::from_str(&env, "Tove Fraction Artwork 7"),
        symbol: String::from_str(&env, "TOVE7"),
        proxy_admin: admin.clone(),
        artist: artist.clone(),
        artist_payout: artist_payout.clone(),
        treasury: treasury.clone(),
        artist_retention: ARTIST_RETENTION,
        artist_lockup_until: ARTIST_LOCKUP_UNTIL,
        treasury_retention: TREASURY_RETENTION,
        treasury_lockup_until: TREASURY_LOCKUP_UNTIL,
        kyc_allowlist: kyc_allowlist.clone(),
        freeze_set: freeze_set.clone(),
        marketplace_settler: marketplace_settler.clone(),
        minter: minter.clone(),
        usdc: usdc.clone(),
        impl_wasm_hash: initial_impl_hash(&env),
    };

    let id = env.register(FractionToken, (init,));
    let client = FractionTokenClient::new(&env, &id);

    Setup {
        env,
        id,
        client,
        admin,
        artist,
        artist_payout,
        treasury,
        kyc_allowlist,
        freeze_set,
        marketplace_settler,
        minter,
        usdc,
        usdc_admin,
        artwork_id,
        gating_admin,
        kyc,
        freeze,
    }
}

/// Mint `amount` USDC (SAC units) to `to` via the SAC admin client. Mocks all
/// auths for the admin op — same caveat as [`allow`].
pub(crate) fn fund_usdc(s: &Setup, to: &Address, amount: i128) {
    s.env.mock_all_auths();
    StellarAssetClient::new(&s.env, &s.usdc).mint(to, &amount);
}

/// USDC balance reader (SDK token client on the real SAC).
fn usdc_balance(s: &Setup, who: &Address) -> i128 {
    TokenClient::new(&s.env, &s.usdc).balance(who)
}

/// Mint the standard fixture distribution: 600 to `a`, 400 to `b`.
/// Requires auths to be mocked by the caller.
pub(crate) fn mint_fixture(s: &Setup) -> (Address, Address) {
    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![&s.env, (a.clone(), 600), (b.clone(), 400)];
    s.client.mint_settle(&s.minter, &recipients);
    (a, b)
}

pub(crate) fn mux(addr: &Address) -> MuxedAddress {
    MuxedAddress::from(addr.clone())
}

/// Whitelist `addr` on the REAL KYC allowlist. Mocks all auths for the
/// gating-admin op — tests that need auth enforcement afterwards must re-set
/// auths themselves.
pub(crate) fn allow(s: &Setup, addr: &Address) {
    s.env.mock_all_auths();
    s.kyc.add(addr);
}

/// Freeze `addr` on the REAL emergency freeze set (fixed test reason hash).
/// Mocks all auths for the gating-admin op — same caveat as [`allow`].
fn freeze_addr(s: &Setup, addr: &Address) {
    s.env.mock_all_auths();
    s.freeze.freeze(addr, &BytesN::from_array(&s.env, &[0xFE; 32]));
}

/// The pinned wire shape of a gating failure (TOV-140): `guard_movement`
/// raises via `panic_with_error!` and the movement fns return unit, so a
/// `try_` client surfaces it as `Err(Ok(SdkError(Contract, code)))` — the
/// same `Error(Contract, #N)` the CLI prints on-chain.
fn gating_err(code: Error) -> Result<SdkError, soroban_sdk::InvokeError> {
    Ok(SdkError::from_contract_error(code as u32))
}

// ─────────────────────────────────────────────────────────────────────────────
// U1 — constructor, write-once storage, admin, economic constants
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn constructor_sets_all_write_once_params_readable_via_getters() {
    let s = setup();
    assert_eq!(s.client.artwork_id(), s.artwork_id);
    assert_eq!(s.client.proxy_admin(), s.admin);
    assert_eq!(s.client.artist(), s.artist);
    assert_eq!(s.client.artist_payout(), s.artist_payout);
    assert_eq!(s.client.treasury(), s.treasury);
    assert_eq!(s.client.artist_retention(), ARTIST_RETENTION);
    assert_eq!(s.client.artist_lockup_until(), ARTIST_LOCKUP_UNTIL);
    assert_eq!(s.client.treasury_retention(), TREASURY_RETENTION);
    assert_eq!(s.client.treasury_lockup_until(), TREASURY_LOCKUP_UNTIL);
    assert_eq!(s.client.kyc_allowlist(), s.kyc_allowlist);
    assert_eq!(s.client.freeze_set(), s.freeze_set);
    assert_eq!(s.client.marketplace_settler(), s.marketplace_settler);
    assert_eq!(s.client.minter(), s.minter);
    assert_eq!(s.client.usdc(), s.usdc);
    assert_eq!(s.client.impl_wasm_hash(), initial_impl_hash(&s.env));
}

#[test]
fn constructor_sets_sep41_metadata_with_zero_decimals() {
    let s = setup();
    // Fractions are indivisible whole units — decimals is pinned to 0.
    assert_eq!(s.client.decimals(), 0);
    assert_eq!(s.client.name(), String::from_str(&s.env, "Tove Fraction Artwork 7"));
    assert_eq!(s.client.symbol(), String::from_str(&s.env, "TOVE7"));
}

#[test]
fn economic_getters_return_compile_time_constants() {
    let s = setup();
    assert_eq!(s.client.royalty_bps(), 150);
    assert_eq!(s.client.platform_fee_bps(), 150);
    assert_eq!(ROYALTY_BPS, 150);
    assert_eq!(PLATFORM_FEE_BPS, 150);
}

#[test]
fn no_entrypoint_can_mutate_economic_params() {
    // AE3, asserted at the API level: the complete exported surface is
    //   __constructor, mint_settle, upgrade, migrate, proxy_admin,
    //   set_proxy_admin, royalty_bps, platform_fee_bps, the write-once
    //   getters (artwork_id..schema_version, is_minted, invariant_snapshot),
    //   and the SEP-41
    //   trait fns (total_supply, balance, allowance, transfer, transfer_from,
    //   approve, decimals, name, symbol, burn, burn_from).
    // None of them accepts an economic parameter: ROYALTY_BPS and
    // PLATFORM_FEE_BPS are compile-time constants with no storage slot, so no
    // write path exists. Exercise every mutating entrypoint and observe the
    // constants unchanged.
    let s = setup();
    s.env.mock_all_auths();

    let (a, b) = mint_fixture(&s);
    allow(&s, &a); // transfer_from destination (KYC gating, TOV-140)
    allow(&s, &b); // transfer destination
    s.client.transfer(&a, &mux(&b), &100);
    s.client.approve(&b, &a, &50, &1000);
    s.client.transfer_from(&a, &b, &a, &25);
    s.client.burn(&a, &10);
    s.client.migrate();
    let new_admin = Address::generate(&s.env);
    s.client.set_proxy_admin(&new_admin);

    assert_eq!(s.client.royalty_bps(), 150);
    assert_eq!(s.client.platform_fee_bps(), 150);
}

#[test]
fn set_proxy_admin_transfers_authority() {
    let s = setup();
    s.env.mock_all_auths();
    let new_admin = Address::generate(&s.env);
    s.client.set_proxy_admin(&new_admin);
    assert_eq!(s.client.proxy_admin(), new_admin);
}

#[test]
fn set_proxy_admin_without_auth_is_rejected() {
    // AE2 (set_proxy_admin leg): no authorization at all → host auth failure,
    // admin unchanged.
    let s = setup();
    let new_admin = Address::generate(&s.env);
    assert!(s.client.try_set_proxy_admin(&new_admin).is_err());
    assert_eq!(s.client.proxy_admin(), s.admin);
}

#[test]
fn pre_mint_defaults_are_zero_supply_and_balances() {
    let s = setup();
    let anyone = Address::generate(&s.env);
    assert_eq!(s.client.total_supply(), 0);
    assert_eq!(s.client.balance(&anyone), 0);
    assert!(!s.client.is_minted());
}

#[test]
fn schema_version_is_one_after_constructor() {
    let s = setup();
    assert_eq!(s.client.schema_version(), CURRENT_SCHEMA_VERSION);
    assert_eq!(s.client.schema_version(), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// U2 — SEP-41 surface, guard funnel, one-shot mint
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn mint_settle_by_minter_credits_balances_supply_and_emits_sep41_mint_events() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);

    // Events reflect only the most recent invocation — assert them BEFORE any
    // getter call (each client read is itself an invocation).
    // OZ `Base::mint` emits SEP-41 mint per recipient:
    // topics ["mint", to], data = map { amount: i128 }.
    let mut data_a = Map::<Symbol, Val>::new(&s.env);
    data_a.set(Symbol::new(&s.env, "amount"), 600_i128.into_val(&s.env));
    let mut data_b = Map::<Symbol, Val>::new(&s.env);
    data_b.set(Symbol::new(&s.env, "amount"), 400_i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![&s.env, Symbol::new(&s.env, "mint").into_val(&s.env), a.into_val(&s.env)],
                data_a.into_val(&s.env),
            ),
            (
                s.id.clone(),
                vec![&s.env, Symbol::new(&s.env, "mint").into_val(&s.env), b.into_val(&s.env)],
                data_b.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&b), 400);
    assert_eq!(s.client.total_supply(), 1000);
    assert!(s.client.is_minted());
}

#[test]
fn second_mint_settle_reverts_already_minted_and_leaves_state_intact() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);

    let again: Vec<(Address, i128)> = vec![&s.env, (a.clone(), 1)];
    let res = s.client.try_mint_settle(&s.minter, &again);

    assert_eq!(res, Err(Ok(Error::AlreadyMinted)));
    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.total_supply(), 1000);
}

#[test]
fn empty_mint_settle_reverts_and_does_not_burn_the_one_shot_flag() {
    let s = setup();
    s.env.mock_all_auths();

    let empty: Vec<(Address, i128)> = vec![&s.env];
    let res = s.client.try_mint_settle(&s.minter, &empty);

    assert_eq!(res, Err(Ok(Error::EmptyMint)));
    assert!(!s.client.is_minted()); // flag intact — a real mint can still happen
    assert_eq!(s.client.total_supply(), 0);
}

#[test]
fn mint_settle_with_non_positive_recipient_amount_reverts_invalid_amount() {
    // LOW: a zero (or negative) recipient amount is a wasted/invalid mint leg;
    // rejected with a typed error before any mint, one-shot flag untouched.
    let s = setup();
    s.env.mock_all_auths();
    let a = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![&s.env, (a.clone(), 0)];
    assert_eq!(
        s.client.try_mint_settle(&s.minter, &recipients),
        Err(Ok(Error::InvalidAmount))
    );
    assert!(!s.client.is_minted());
    assert_eq!(s.client.total_supply(), 0);
}

#[test]
fn record_absorbed_leftover_rejects_negative_amount() {
    // LOW: a negative leftover would drop the artist lockup floor below
    // artist_retention, silently weakening the lockup. Rejected.
    let s = setup();
    s.env.mock_all_auths();
    assert_eq!(
        s.client.try_record_absorbed_leftover(&s.minter, &-1),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn mint_settle_by_authorized_non_minter_reverts_unauthorized_minter() {
    // Pinned ordering, leg 2: when the operator IS authenticated (auths
    // mocked) but is not the configured minter, the typed error fires.
    let s = setup();
    s.env.mock_all_auths();
    let mallory = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![&s.env, (mallory.clone(), 1000)];

    let res = s.client.try_mint_settle(&mallory, &recipients);

    assert_eq!(res, Err(Ok(Error::UnauthorizedMinter)));
    assert_eq!(s.client.total_supply(), 0);
    assert!(!s.client.is_minted());
}

#[test]
fn mint_settle_without_auth_fails_with_auth_error_before_typed_check() {
    // Pinned ordering, leg 1: `operator.require_auth()` runs FIRST. With no
    // authorization at all the call fails at the host auth layer — an invoke
    // error (Err(Err(..))), NOT the typed UnauthorizedMinter (Err(Ok(..))).
    let s = setup();
    let mallory = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![&s.env, (mallory.clone(), 1000)];

    let res = s.client.try_mint_settle(&mallory, &recipients);

    assert!(matches!(res, Err(Err(_))));
    s.env.mock_all_auths();
    assert_eq!(s.client.total_supply(), 0);
}

#[test]
fn transfer_moves_balance_and_emits_sep41_transfer_event() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c); // KYC gating (TOV-140): destination must be whitelisted

    s.client.transfer(&a, &mux(&c), &150);

    // SEP-41 transfer (non-muxed destination): topics
    // ["transfer", from, to], data = bare i128 amount. Asserted before any
    // getter — events reflect only the most recent invocation.
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "transfer").into_val(&s.env),
                    a.into_val(&s.env),
                    c.into_val(&s.env),
                ],
                150_i128.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.client.balance(&a), 450);
    assert_eq!(s.client.balance(&c), 150);
    assert_eq!(s.client.total_supply(), 1000); // transfer never mints/burns
}

#[test]
fn approve_then_transfer_from_moves_balance_and_consumes_allowance() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let spender = Address::generate(&s.env);
    let dest = Address::generate(&s.env);
    allow(&s, &dest); // KYC gating (TOV-140)

    s.client.approve(&a, &spender, &200, &1000);
    assert_eq!(s.client.allowance(&a, &spender), 200);

    s.client.transfer_from(&spender, &a, &dest, &120);

    assert_eq!(s.client.balance(&a), 480);
    assert_eq!(s.client.balance(&dest), 120);
    assert_eq!(s.client.allowance(&a, &spender), 80);
}

#[test]
fn transfer_without_from_auth_is_rejected_and_balances_intact() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c); // gating satisfied — the failure below is pure host auth
    s.env.set_auths(&[]); // drop all authorizations for the next call

    let res = s.client.try_transfer(&a, &mux(&c), &150);

    assert!(res.is_err());
    s.env.mock_all_auths();
    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&c), 0);
}

#[test]
fn burn_reduces_supply_and_emits_sep41_burn_event() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);

    s.client.burn(&a, &100);

    // SEP-41 burn: topics ["burn", from], data = map { amount: i128 }.
    // Asserted before any getter — events reflect the most recent invocation.
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "amount"), 100_i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![&s.env, Symbol::new(&s.env, "burn").into_val(&s.env), a.into_val(&s.env)],
                data.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.client.balance(&a), 500);
    assert_eq!(s.client.total_supply(), 900);
}

#[test]
fn burn_from_with_allowance_reduces_supply_and_allowance() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let spender = Address::generate(&s.env);

    s.client.approve(&a, &spender, &80, &1000);
    s.client.burn_from(&spender, &a, &80);

    assert_eq!(s.client.balance(&a), 520);
    assert_eq!(s.client.total_supply(), 920);
    assert_eq!(s.client.allowance(&a, &spender), 0);
}

#[test]
fn sep41_surface_is_complete_via_generic_token_client() {
    // The whole SEP-41 interface is callable through the SDK's generic
    // `token::TokenClient` (TokenInterface) — proving interface conformance,
    // the foundation for TOV-144. Movement still routes through our
    // overridden entrypoints (same exported fns), i.e. through the guard
    // funnel.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a); // transfer_from destination (KYC gating, TOV-140)
    allow(&s, &b); // transfer destination
    let tc = TokenClient::new(&s.env, &s.id);

    assert_eq!(tc.decimals(), 0);
    assert_eq!(tc.name(), String::from_str(&s.env, "Tove Fraction Artwork 7"));
    assert_eq!(tc.symbol(), String::from_str(&s.env, "TOVE7"));
    assert_eq!(tc.balance(&a), 600);

    tc.transfer(&a, &mux(&b), &50);
    assert_eq!(tc.balance(&a), 550);
    assert_eq!(tc.balance(&b), 450);

    tc.approve(&b, &a, &30, &1000);
    assert_eq!(tc.allowance(&b, &a), 30);
    tc.transfer_from(&a, &b, &a, &30);
    assert_eq!(tc.balance(&a), 580);

    tc.burn(&a, &20);
    assert_eq!(s.client.total_supply(), 980);
}

// ─────────────────────────────────────────────────────────────────────────────
// U3 — upgrade seam + schema gate (AE1/AE2)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn upgrade_by_admin_preserves_address_and_all_state_and_emits_old_new_hashes() {
    // AE1: fill state (mint + transfer), upgrade the executable by admin →
    // same address, ALL state readable and intact by the new code, event
    // carries old + new hash.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c); // KYC gating (TOV-140)
    s.client.transfer(&a, &mux(&c), &150);

    let old_hash = s.client.impl_wasm_hash();
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    assert_ne!(old_hash, new_hash);

    s.client.upgrade(&new_hash);

    // proxy.upgraded event: topics ["proxy", "upgraded", old, new] — hashes
    // ride in the topics (registry-anchor event style); no data fields, so
    // the data section is an empty map.
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "proxy").into_val(&s.env),
                    Symbol::new(&s.env, "upgraded").into_val(&s.env),
                    old_hash.into_val(&s.env),
                    new_hash.into_val(&s.env),
                ],
                Map::<Symbol, Val>::new(&s.env).into_val(&s.env),
            ),
        ]
    );

    // Same address (same client, same contract id), executable swapped.
    assert_eq!(s.client.impl_wasm_hash(), new_hash);

    // Balances and supply intact.
    assert_eq!(s.client.balance(&a), 450);
    assert_eq!(s.client.balance(&b), 400);
    assert_eq!(s.client.balance(&c), 150);
    assert_eq!(s.client.total_supply(), 1000);
    assert!(s.client.is_minted());

    // Write-once params and metadata intact.
    assert_eq!(s.client.artwork_id(), s.artwork_id);
    assert_eq!(s.client.proxy_admin(), s.admin);
    assert_eq!(s.client.artist(), s.artist);
    assert_eq!(s.client.artist_payout(), s.artist_payout);
    assert_eq!(s.client.treasury(), s.treasury);
    assert_eq!(s.client.artist_retention(), ARTIST_RETENTION);
    assert_eq!(s.client.artist_lockup_until(), ARTIST_LOCKUP_UNTIL);
    assert_eq!(s.client.treasury_retention(), TREASURY_RETENTION);
    assert_eq!(s.client.treasury_lockup_until(), TREASURY_LOCKUP_UNTIL);
    assert_eq!(s.client.kyc_allowlist(), s.kyc_allowlist);
    assert_eq!(s.client.freeze_set(), s.freeze_set);
    assert_eq!(s.client.marketplace_settler(), s.marketplace_settler);
    assert_eq!(s.client.minter(), s.minter);
    assert_eq!(s.client.usdc(), s.usdc);
    assert_eq!(s.client.decimals(), 0);
    assert_eq!(s.client.symbol(), String::from_str(&s.env, "TOVE7"));
    assert_eq!(s.client.schema_version(), 1);

    // TOV-150: the upgrade raised the migration-pending seal (snapshot
    // recorded); migrate() on the canonical executable lifts it. The reads
    // above all ran WHILE pending — getters stay live during the seal.
    assert!(s.client.invariant_snapshot().is_some());
    s.client.migrate();
    assert!(s.client.invariant_snapshot().is_none());
}

#[test]
fn upgrade_without_admin_auth_is_rejected_and_state_intact() {
    // AE2: caller without admin authorization cannot upgrade; state (impl
    // hash, balances) is untouched.
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.env.set_auths(&[]); // drop authorizations for the upgrade attempt

    let res = s.client.try_upgrade(&new_hash);

    assert!(res.is_err());
    s.env.mock_all_auths();
    assert_eq!(s.client.impl_wasm_hash(), initial_impl_hash(&s.env));
    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.total_supply(), 1000);
}

#[test]
fn migrate_with_current_schema_is_noop_ok() {
    // Pinned stub semantics: stored version == CURRENT_SCHEMA_VERSION →
    // Ok(()), nothing transformed, version unchanged. Idempotent.
    let s = setup();
    s.env.mock_all_auths();

    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
    assert_eq!(s.client.try_migrate(), Ok(Ok(()))); // idempotent
    assert_eq!(s.client.schema_version(), CURRENT_SCHEMA_VERSION);
}

#[test]
fn migrate_with_incompatible_schema_reverts_invariant_violated() {
    // Pinned stub semantics: any stored version other than
    // CURRENT_SCHEMA_VERSION → Error::InvariantViolated (this executable can
    // neither run nor migrate that layout). Simulate an incompatible layout
    // by overwriting the stored schema version directly.
    let s = setup();
    s.env.mock_all_auths();

    s.env.as_contract(&s.id, || {
        stellar_contract_utils::upgradeable::set_schema_version(&s.env, 2);
    });

    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));
    assert_eq!(s.client.schema_version(), 2); // gate does not touch the version
}

#[test]
fn migrate_without_admin_auth_is_rejected() {
    let s = setup();
    assert!(s.client.try_migrate().is_err());
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-150 — migration-pending seal + invariant snapshot + migrate gate
//
// `upgrade` records the InvariantSnapshot and raises the pending seal; every
// balance-moving path reverts #11 until `migrate` (canonical constants)
// lifts it. Full live-state-vs-snapshot verification is TOV-151.
// ─────────────────────────────────────────────────────────────────────────────

/// The pre-upgrade baseline the standard [`mint_fixture`] produces.
fn baseline_snapshot(s: &Setup) -> InvariantSnapshot {
    InvariantSnapshot {
        total_supply: 1000,
        artist_lockup_until: ARTIST_LOCKUP_UNTIL,
        treasury_lockup_until: TREASURY_LOCKUP_UNTIL,
        minted: true,
        // Computed live from the (write-once) config so the expected snapshot
        // carries the real fingerprint. Stable across a test — none of the
        // corruption hooks except `corrupt_usdc` touch a covered slot.
        config_digest: s.env.as_contract(&s.id, || crate::contract::config_digest(&s.env)),
    }
}

#[test]
fn ae1_pending_seals_all_seven_movement_paths_then_migrate_reopens() {
    // AE1 / R1+R2, full cycle: state → upgrade(same wasm) → EVERY balance-
    // moving path reverts #11 → migrate() → movement live again, state
    // intact, migration.completed decoded exact.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a);
    allow(&s, &b);
    let spender = Address::generate(&s.env);
    s.client.approve(&a, &spender, &100, &1000); // allowance set BEFORE the seal

    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);

    // Snapshot recorded from the pre-upgrade state (pinned values).
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));

    // Paths 1–4: the SEP-41 movement fns panic-seal → wire shape
    // Err(Contract, #11), same shape as every guard error.
    let sealed = gating_err(Error::MigrationPending);
    assert_eq!(s.client.try_transfer(&a, &mux(&b), &10).err().unwrap(), sealed.clone());
    assert_eq!(
        s.client.try_transfer_from(&spender, &a, &b, &10).err().unwrap(),
        sealed.clone()
    );
    assert_eq!(s.client.try_burn(&a, &10).err().unwrap(), sealed.clone());
    assert_eq!(s.client.try_burn_from(&spender, &a, &10).err().unwrap(), sealed);

    // Path 5: settle_trade inherits the seal via guard_movement — typed
    // shape (Result-returning fn). Params valid, so #11 is GENUINELY the
    // seal, not InvalidTrade (pinned order: auth → InvalidTrade → #11).
    assert_eq!(
        s.client.try_settle_trade(&b, &a, &1, &0),
        Err(Ok(Error::MigrationPending))
    );

    // Path 6: record_absorbed_leftover — typed seal, outranking
    // AlreadyMinted (this fixture IS minted; pending wins).
    assert_eq!(
        s.client.try_record_absorbed_leftover(&s.minter, &30),
        Err(Ok(Error::MigrationPending))
    );

    // Path 6b: mint_settle on the minted fixture — pending outranks
    // AlreadyMinted here too (pinned typed-check order).
    let recipients: Vec<(Address, i128)> = vec![&s.env, (a.clone(), 1)];
    assert_eq!(
        s.client.try_mint_settle(&s.minter, &recipients),
        Err(Ok(Error::MigrationPending))
    );

    // Path 7 (honest leg): a FRESH un-minted token, where mint_settle would
    // otherwise succeed — the seal alone blocks it, and the un-minted
    // snapshot pins {supply 0, minted false}.
    let s2 = setup();
    s2.env.mock_all_auths();
    let hash2 = s2.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s2.client.upgrade(&hash2);
    assert_eq!(
        s2.client.invariant_snapshot(),
        Some(InvariantSnapshot {
            total_supply: 0,
            artist_lockup_until: ARTIST_LOCKUP_UNTIL,
            treasury_lockup_until: TREASURY_LOCKUP_UNTIL,
            minted: false,
            config_digest: s2.env.as_contract(&s2.id, || crate::contract::config_digest(&s2.env)),
        })
    );
    let r = Address::generate(&s2.env);
    let fresh: Vec<(Address, i128)> = vec![&s2.env, (r.clone(), 100)];
    assert_eq!(
        s2.client.try_mint_settle(&s2.minter, &fresh),
        Err(Ok(Error::MigrationPending))
    );
    assert!(!s2.client.is_minted());
    assert_eq!(s2.client.total_supply(), 0);

    // migrate() lifts the seal. migration.completed decoded exact: topics
    // ["migration", "completed"], schema in the data map (R6).
    s.client.migrate();
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "schema"), CURRENT_SCHEMA_VERSION.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "migration").into_val(&s.env),
                    Symbol::new(&s.env, "completed").into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );
    assert_eq!(s.client.invariant_snapshot(), None); // seal + snapshot gone
    assert_eq!(s.client.schema_version(), CURRENT_SCHEMA_VERSION);

    // State fully intact — the sealed attempts moved nothing, and movement
    // is live again on the verified executable.
    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&b), 400);
    assert_eq!(s.client.total_supply(), 1000);
    assert_eq!(s.client.allowance(&a, &spender), 100); // nothing consumed
    s.client.transfer(&a, &mux(&b), &10);
    assert_eq!(s.client.balance(&a), 590);
    assert_eq!(s.client.balance(&b), 410);

    // Double-migrate after a successful cycle: not pending, schema current →
    // no-op Ok (pinned, same as the pre-TOV-150 arm).
    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
}

#[test]
fn admin_ops_stay_live_while_migration_pending() {
    // R2 (recovery path): while the seal blocks movement, EVERY admin op —
    // proxy_admin getter, set_proxy_admin, a further upgrade, migrate —
    // keeps working; they are how an incident gets fixed.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);

    assert_eq!(s.client.proxy_admin(), s.admin); // getter live
    let new_admin = Address::generate(&s.env);
    s.client.set_proxy_admin(&new_admin); // rotation live
    assert_eq!(s.client.proxy_admin(), new_admin);

    // A further upgrade while pending still swaps + updates the hash record
    // (event asserted in the snapshot-retention test below).
    s.client.upgrade(&new_hash);
    assert_eq!(s.client.impl_wasm_hash(), new_hash);

    // ... and migrate completes the cycle: movement live again.
    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
    s.client.transfer(&a, &mux(&b), &5);
    assert_eq!(s.client.balance(&b), 405);
}

#[test]
fn migrate_without_admin_auth_while_pending_is_rejected_and_seal_holds() {
    // R2: migrate is proxy_admin-only. An unauthenticated call fails at the
    // HOST auth layer (Err(Err(_)), never a typed error) and the seal —
    // snapshot included — holds.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);
    s.env.set_auths(&[]); // enforcing mode: nobody authorizes anything

    assert!(matches!(s.client.try_migrate(), Err(Err(_))));

    s.env.mock_all_auths();
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));
    assert_eq!(
        s.client.try_transfer(&a, &mux(&b), &10).err().unwrap(),
        gating_err(Error::MigrationPending)
    );
}

#[test]
fn second_upgrade_while_pending_keeps_first_snapshot_as_baseline() {
    // PINNED security decision: a further upgrade while pending does NOT
    // re-record the snapshot — the FIRST snapshot is the pre-incident
    // baseline. Re-snapshotting would launder whatever a rogue interim
    // executable mutated into the new baseline; recovery must be judged
    // against the last known-good state.
    let s = setup();
    s.env.mock_all_auths();
    mint_fixture(&s);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));

    // Simulate the rogue interim executable: shorten the artist lockup
    // directly in storage while the migration is pending.
    s.env.as_contract(&s.id, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::ArtistLockupUntil, &(ARTIST_LOCKUP_UNTIL - 1_000));
    });

    // Recovery upgrade while STILL pending: the swap happens (event + hash
    // record — this leg of upgrade is not skipped), but the snapshot is NOT
    // overwritten with the tampered value.
    let old_recorded = s.client.impl_wasm_hash();
    s.client.upgrade(&new_hash);
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "proxy").into_val(&s.env),
                    Symbol::new(&s.env, "upgraded").into_val(&s.env),
                    old_recorded.into_val(&s.env),
                    new_hash.into_val(&s.env),
                ],
                Map::<Symbol, Val>::new(&s.env).into_val(&s.env),
            ),
        ]
    );
    assert_eq!(s.client.impl_wasm_hash(), new_hash);

    // First snapshot retained — original lockup, NOT the tampered one.
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));
    assert_eq!(s.client.artist_lockup_until(), ARTIST_LOCKUP_UNTIL - 1_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-151 — full invariant gate, proven against a REAL hostile executable
//
// The evil fixture (`test-fixtures/tove-evil-fraction-token`, NEVER DEPLOY)
// carries ROYALTY_BPS = 400, mirrors the storage layout by variant/field name,
// and exposes unauthenticated corruption hooks. Its `migrate()` has the
// canonical logic shape (so the constant self-check fires with the evil 400);
// `migrate_skip_constant_check()` runs ONLY the snapshot arms — constants are
// compile-time, so one fixture cannot both fail the constant check and let a
// snapshot violation surface through `migrate()`; the skip variant isolates
// each snapshot arm honestly inside the hostile executable.
//
// While the evil wasm is installed, the canonical entrypoints (transfer,
// invariant_snapshot, …) do not exist — the "seal holds"/"snapshot retained"
// facts are asserted at the storage level via `as_contract` (env-level truth,
// independent of the installed executable) and re-asserted through the
// canonical getters after the recovery upgrade.
// ─────────────────────────────────────────────────────────────────────────────

// The hostile fixture's built WASM (same build arrangement as `token_wasm`).
mod evil_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/tove_evil_fraction_token.wasm"
    );
}

/// Upgrade the fixture token to the EVIL executable and return a client for
/// the evil-only entrypoints, plus proof the swap really happened
/// (`royalty_bps` reads 400 — only the evil build carries that constant).
fn upgrade_to_evil<'a>(s: &Setup<'a>) -> evil_wasm::Client<'a> {
    let evil_hash = s.env.deployer().upload_contract_wasm(evil_wasm::WASM);
    s.client.upgrade(&evil_hash);
    let evil = evil_wasm::Client::new(&s.env, &s.id);
    assert_eq!(evil.royalty_bps(), 400);
    evil
}

/// Storage-level read of the pending seal — works whatever executable is
/// installed (testutils reads the env's storage directly).
fn stored_pending(s: &Setup) -> bool {
    s.env
        .as_contract(&s.id, || s.env.storage().instance().has(&DataKey::MigrationPending))
}

/// Storage-level read of the retained snapshot — same rationale.
fn stored_snapshot(s: &Setup) -> Option<InvariantSnapshot> {
    s.env
        .as_contract(&s.id, || s.env.storage().instance().get(&DataKey::InvariantSnapshot))
}

/// The pinned wire shape of a snapshot-arm failure surfaced through the
/// EVIL-side client (`contractimport` generates its own `Error` mirror from
/// the wasm spec — same name, same code #1).
fn evil_invariant_violated() -> Result<
    Result<(), soroban_sdk::ConversionError>,
    Result<evil_wasm::Error, soroban_sdk::InvokeError>,
> {
    Err(Ok(evil_wasm::Error::InvariantViolated))
}

#[test]
fn ae2_evil_executable_migrate_reverts_1_seal_and_snapshot_retained() {
    // AE2 / R3: upgrade to the evil wasm (royalty 400). migrate — now
    // dispatching to the EVIL executable — reverts InvariantViolated (#1) on
    // its own constant self-check, repeatably (the gate is not consumable),
    // and both the pending seal and the pre-incident snapshot survive.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    upgrade_to_evil(&s);

    // The canonical client still targets the same contract id; `migrate` is
    // exported by the evil build too — with its 400 constant it fails #1.
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));
    assert!(stored_pending(&s));
    assert_eq!(stored_snapshot(&s), Some(baseline_snapshot(&s)));
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated))); // still

    // Recovery upgrade back to the canonical wasm (via the EVIL executable's
    // own upgrade export — the escape hatch): the seal STILL holds until a
    // successful migrate — transfer #11 on the canonical build, snapshot
    // readable again through the canonical getter, untouched.
    let canonical_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&canonical_hash);
    assert_eq!(
        s.client.try_transfer(&a, &mux(&b), &10).err().unwrap(),
        gating_err(Error::MigrationPending)
    );
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));
}

#[test]
fn ae3_corrupt_supply_trips_gate_and_collision_write_hits_the_oz_slot() {
    // AE3 / R4 (supply arm), isolated via migrate_skip_constant_check: the
    // evil hook rewrites the OZ TotalSupply slot (+100), the snapshot
    // comparison catches it. Then the collision-write prediction is proven
    // end-to-end: after recovery the CANONICAL Base::total_supply reads the
    // corrupted value — the fixture's local `DataKey::TotalSupply` variant
    // serialized onto OZ's `FungibleStorageKey::TotalSupply` key exactly as
    // the variant-name rule says. And pinned hard: corrupted state can NEVER
    // pass the gate, not even on the canonical executable — funds stay
    // sealed rather than laundering the corruption.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s); // supply 1000
    allow(&s, &b);
    let evil = upgrade_to_evil(&s);

    evil.corrupt_supply(&1_100);

    // Supply arm, isolated (constants skipped): #1, seal + snapshot retained.
    assert_eq!(evil.try_migrate_skip_constant_check(), evil_invariant_violated());
    assert!(stored_pending(&s));
    assert_eq!(stored_snapshot(&s), Some(baseline_snapshot(&s)));
    // Full evil migrate: also #1 (constant arm fires first, pinned order).
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));

    // Recovery upgrade → the canonical OZ read sees the corrupted value:
    // the collision write landed in the real supply slot.
    let canonical_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&canonical_hash);
    assert_eq!(s.client.total_supply(), 1_100);

    // Canonical executable, corrupted state: migrate still #1, movement
    // still sealed (#11), baseline still retained for a future remediation.
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));
    assert_eq!(
        s.client.try_transfer(&a, &mux(&b), &10).err().unwrap(),
        gating_err(Error::MigrationPending)
    );
    assert_eq!(s.client.invariant_snapshot(), Some(baseline_snapshot(&s)));
}

#[test]
fn evil_corrupt_usdc_config_slot_trips_gate_on_recovery() {
    // M3 (config arm): the evil hook repoints the WRITE-ONCE Usdc slot to a fake
    // token — a supply-preserving config corruption the old snapshot (supply /
    // lockups / mint only) could not catch. The canonical config_digest recorded
    // at upgrade no longer matches, so migrate on the recovered canonical build
    // rejects InvariantViolated and the funds stay sealed.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    let evil = upgrade_to_evil(&s);

    let fake_usdc = Address::generate(&s.env);
    evil.corrupt_usdc(&fake_usdc);

    // Recover to the canonical executable (via the evil upgrade escape hatch;
    // the pending snapshot is retained), then attempt migrate.
    let canonical_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&canonical_hash);

    // Supply / lockups / mint are all intact — only the config_digest arm trips.
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));
    // Still sealed; the pre-incident baseline is retained for a bespoke migrate.
    assert!(stored_pending(&s));
    assert_eq!(
        s.client.try_transfer(&a, &mux(&b), &1).err().unwrap(),
        gating_err(Error::MigrationPending)
    );
}

#[test]
fn evil_shortened_artist_lockup_trips_gate_seal_and_snapshot_retained() {
    // R4 (artist-lockup arm), isolated: the hook cuts the lockup short by one
    // second — `stored < snapshot` trips #1 even at the minimal delta.
    let s = setup();
    s.env.mock_all_auths();
    mint_fixture(&s);
    let evil = upgrade_to_evil(&s);

    evil.shorten_artist_lockup(&(ARTIST_LOCKUP_UNTIL - 1));

    assert_eq!(evil.try_migrate_skip_constant_check(), evil_invariant_violated());
    assert!(stored_pending(&s));
    assert_eq!(stored_snapshot(&s), Some(baseline_snapshot(&s)));
}

#[test]
fn evil_cleared_mint_flag_trips_gate_seal_and_snapshot_retained() {
    // R4 (mint-flag arm), isolated: erasing MintDone (which would re-arm the
    // one-shot mint_settle for an inflationary second distribution) makes
    // presence(false) != snapshot.minted(true) → #1.
    let s = setup();
    s.env.mock_all_auths();
    mint_fixture(&s);
    let evil = upgrade_to_evil(&s);

    evil.clear_mint_flag();

    assert_eq!(evil.try_migrate_skip_constant_check(), evil_invariant_violated());
    assert!(stored_pending(&s));
    assert_eq!(stored_snapshot(&s), Some(baseline_snapshot(&s)));
}

#[test]
fn treasury_lockup_decrease_trips_gate_even_on_canonical_executable() {
    // R4 (treasury-lockup arm): the evil fixture has no treasury hook, so
    // this arm is exercised on the CANONICAL executable — same-wasm upgrade,
    // then the rogue-interim tamper simulated at storage level (the same
    // technique the TOV-150 snapshot-retention test pins). Proves the arm
    // lives in the canonical migrate, not only in the fixture's mirror.
    let s = setup();
    s.env.mock_all_auths();
    mint_fixture(&s);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);

    s.env.as_contract(&s.id, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::TreasuryLockupUntil, &(TREASURY_LOCKUP_UNTIL - 1));
    });

    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));
    assert!(stored_pending(&s));
    assert_eq!(stored_snapshot(&s), Some(baseline_snapshot(&s)));
}

#[test]
fn lockup_extensions_pass_the_gate_monotonic_not_equality() {
    // R4 boundary, good side: the lockup arms are `>=`, not `==` — EXTENDING
    // either lockup while pending is legitimate governance, and migrate
    // completes (supply/flag untouched). Pins the monotonic semantics.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);

    s.env.as_contract(&s.id, || {
        s.env
            .storage()
            .instance()
            .set(&DataKey::ArtistLockupUntil, &(ARTIST_LOCKUP_UNTIL + 1_000));
        s.env
            .storage()
            .instance()
            .set(&DataKey::TreasuryLockupUntil, &(TREASURY_LOCKUP_UNTIL + 1_000));
    });

    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
    assert_eq!(s.client.invariant_snapshot(), None);
    s.client.transfer(&a, &mux(&b), &10); // movement live again
    assert_eq!(s.client.balance(&b), 410);
}

#[test]
fn ae4_recovery_from_evil_upgrade_restores_state_byte_identical() {
    // AE4 / R5, the full incident-and-recovery cycle on the PURE AE2 path
    // (no hook corruption — corrupted state is sealed forever by design,
    // pinned in the AE3 test): capture the pre-incident state → upgrade to
    // evil → migrate fails #1 → upgrade back to canonical → migrate Ok →
    // every captured value byte-identical → movement works.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a);
    allow(&s, &b);
    let spender = Address::generate(&s.env);
    s.client.approve(&a, &spender, &100, &1000);

    // Pre-incident capture.
    let pre_balance_a = s.client.balance(&a);
    let pre_balance_b = s.client.balance(&b);
    let pre_supply = s.client.total_supply();
    let pre_allowance = s.client.allowance(&a, &spender);
    let pre_artist_lockup = s.client.artist_lockup_until();
    let pre_treasury_lockup = s.client.treasury_lockup_until();
    let pre_minted = s.client.is_minted();

    // Incident: evil executable installed, migrate rejected.
    upgrade_to_evil(&s);
    assert_eq!(s.client.try_migrate(), Err(Ok(Error::InvariantViolated)));

    // Recovery: upgrade back to the canonical wasm, migrate passes against
    // the retained baseline, seal + snapshot gone, schema stamped.
    let canonical_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&canonical_hash);
    assert_eq!(s.client.impl_wasm_hash(), canonical_hash);
    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
    assert!(!stored_pending(&s));
    assert_eq!(s.client.invariant_snapshot(), None);
    assert_eq!(s.client.schema_version(), CURRENT_SCHEMA_VERSION);

    // State byte-identical to the pre-incident capture.
    assert_eq!(s.client.balance(&a), pre_balance_a);
    assert_eq!(s.client.balance(&b), pre_balance_b);
    assert_eq!(s.client.total_supply(), pre_supply);
    assert_eq!(s.client.allowance(&a, &spender), pre_allowance);
    assert_eq!(s.client.artist_lockup_until(), pre_artist_lockup);
    assert_eq!(s.client.treasury_lockup_until(), pre_treasury_lockup);
    assert_eq!(s.client.is_minted(), pre_minted);
    assert_eq!(s.client.royalty_bps(), 150); // canonical constants back

    // Movement live again — the incident cost nothing but the two upgrades.
    s.client.transfer(&a, &mux(&b), &10);
    assert_eq!(s.client.balance(&a), pre_balance_a - 10);
    assert_eq!(s.client.balance(&b), pre_balance_b + 10);
}

#[test]
fn good_path_same_wasm_upgrade_migrate_ok_snapshot_matches_trivially() {
    // Good-path regression with the FULL snapshot comparison now live: a
    // same-wasm upgrade with untouched state sails through migrate — the
    // snapshot matches trivially and the gate costs an honest upgrade
    // nothing. (The richer AE1 cycle above pins the same path with events.)
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &b);
    let new_hash = s.env.deployer().upload_contract_wasm(token_wasm::WASM);
    s.client.upgrade(&new_hash);

    assert_eq!(s.client.try_migrate(), Ok(Ok(())));
    assert_eq!(s.client.invariant_snapshot(), None);
    s.client.transfer(&a, &mux(&b), &10);
    assert_eq!(s.client.balance(&b), 410);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-140 — hybrid KYC gating in guard_movement (REAL gating contracts in Env)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn ae1_transfer_to_non_whitelisted_recipient_reverts_5_and_balances_intact() {
    // AE1 / R1: recipient not on the allowlist → Error(Contract, #5), no
    // balance moves — on both transfer AND transfer_from.
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env); // never whitelisted

    let res = s.client.try_transfer(&a, &mux(&c), &150);
    assert_eq!(res.err().unwrap(), gating_err(Error::RecipientNotWhitelisted));

    let spender = Address::generate(&s.env);
    s.client.approve(&a, &spender, &200, &1000);
    let res = s.client.try_transfer_from(&spender, &a, &c, &120);
    assert_eq!(res.err().unwrap(), gating_err(Error::RecipientNotWhitelisted));

    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&c), 0);
    assert_eq!(s.client.allowance(&a, &spender), 200); // nothing consumed
    assert_eq!(s.client.total_supply(), 1000);
}

#[test]
fn ae2_frozen_sender_reverts_6_on_transfer_and_burn() {
    // AE2 / R2: frozen(from) blocks every movement — transfer and burn alike
    // (burn checks from only; there is no `to`).
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a);
    allow(&s, &b);
    freeze_addr(&s, &a);

    let res = s.client.try_transfer(&a, &mux(&b), &100);
    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));

    let res = s.client.try_burn(&a, &100);
    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));

    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&b), 400);
    assert_eq!(s.client.total_supply(), 1000);
}

#[test]
fn ae3_frozen_recipient_reverts_6_even_when_whitelisted() {
    // AE3 / R2: frozen(to) blocks a transfer even though the recipient passes
    // KYC — freeze is checked (and reported) ahead of the allowlist.
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c);
    freeze_addr(&s, &c);

    let res = s.client.try_transfer(&a, &mux(&c), &100);

    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));
    assert_eq!(s.client.balance(&a), 600);
    assert_eq!(s.client.balance(&c), 0);
}

#[test]
fn ae4_revoking_allowlist_blocks_the_next_transfer_without_redeploy() {
    // AE4 / R3: gating reads are LIVE cross-contract calls against the stored
    // address — an allowlist revocation takes effect on the very next
    // movement, no token redeploy involved.
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    s.client.transfer(&a, &mux(&c), &100); // first transfer passes

    s.kyc.remove(&c); // gating-admin revokes (auths still mocked)

    let res = s.client.try_transfer(&a, &mux(&c), &100);
    assert_eq!(res.err().unwrap(), gating_err(Error::RecipientNotWhitelisted));
    assert_eq!(s.client.balance(&a), 500);
    assert_eq!(s.client.balance(&c), 100); // only the first transfer landed
}

#[test]
fn happy_path_all_movements_pass_with_allowed_unfrozen_parties() {
    // R5: holders that satisfy the gating transact exactly as before — all
    // four movement entrypoints run through the filled funnel unchanged.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a);
    allow(&s, &b);
    let spender = Address::generate(&s.env);

    s.client.transfer(&a, &mux(&b), &100); // a 500, b 500

    s.client.approve(&b, &spender, &200, &1000);
    s.client.transfer_from(&spender, &b, &a, &150); // a 650, b 350

    s.client.burn(&a, &50); // a 600

    s.client.approve(&a, &spender, &80, &1000);
    s.client.burn_from(&spender, &a, &80); // a 520

    assert_eq!(s.client.balance(&a), 520);
    assert_eq!(s.client.balance(&b), 350);
    assert_eq!(s.client.total_supply(), 870);
}

#[test]
fn pinned_order_frozen_sender_wins_over_non_whitelisted_recipient() {
    // Pinned check order: frozen(from) → frozen(to) → kyc(to). With BOTH a
    // frozen sender and a non-whitelisted recipient, the freeze fires — #6,
    // never #5 (freeze = emergency intervention, the most important signal).
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env); // NOT whitelisted
    freeze_addr(&s, &a);

    let res = s.client.try_transfer(&a, &mux(&c), &100);

    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));
}

#[test]
fn set_kyc_allowlist_rotates_emits_event_and_movement_consults_new_contract() {
    // R4 + R3: admin rotates the allowlist to a SECOND real instance with
    // different membership; the movement outcome flips — proof the guard
    // consults the stored (new) address live, not a cache.
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);

    // Second REAL allowlist where c IS a member (it is not on the first).
    let kyc2_id = s.env.register(KycAllowlist, (s.gating_admin.clone(),));
    let kyc2 = KycAllowlistClient::new(&s.env, &kyc2_id);
    kyc2.add(&c);

    // Old allowlist governs: c not whitelisted → #5.
    let res = s.client.try_transfer(&a, &mux(&c), &100);
    assert_eq!(res.err().unwrap(), gating_err(Error::RecipientNotWhitelisted));

    s.client.set_kyc_allowlist(&kyc2_id);

    // gating.updated: topics ["gating", "updated", kind]; old/new in the data
    // map (Soroban caps events at 4 topics). Asserted straight after the
    // setter — events reflect only the most recent invocation.
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "old"), s.kyc_allowlist.into_val(&s.env));
    data.set(Symbol::new(&s.env, "new"), kyc2_id.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "gating").into_val(&s.env),
                    Symbol::new(&s.env, "updated").into_val(&s.env),
                    Symbol::new(&s.env, "kyc").into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );
    assert_eq!(s.client.kyc_allowlist(), kyc2_id);

    // New allowlist governs: the SAME transfer now passes.
    s.client.transfer(&a, &mux(&c), &100);
    assert_eq!(s.client.balance(&c), 100);
}

#[test]
fn set_freeze_set_rotates_emits_event_and_movement_consults_new_contract() {
    // Freeze-set leg of R4 + R3: a sender frozen on the OLD set moves again
    // once the token points at a fresh set — and the event carries kind
    // "freeze" with old/new addresses.
    let s = setup();
    s.env.mock_all_auths();
    let (a, b) = mint_fixture(&s);
    allow(&s, &a);
    allow(&s, &b);
    freeze_addr(&s, &a);

    let res = s.client.try_transfer(&a, &mux(&b), &100);
    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));

    // Second REAL freeze set (nobody frozen on it).
    let freeze2_id = s.env.register(EmergencyFreeze, (s.gating_admin.clone(),));

    s.client.set_freeze_set(&freeze2_id);

    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "old"), s.freeze_set.into_val(&s.env));
    data.set(Symbol::new(&s.env, "new"), freeze2_id.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "gating").into_val(&s.env),
                    Symbol::new(&s.env, "updated").into_val(&s.env),
                    Symbol::new(&s.env, "freeze").into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );
    assert_eq!(s.client.freeze_set(), freeze2_id);

    // The new set governs: a is not frozen there → the transfer passes.
    s.client.transfer(&a, &mux(&b), &100);
    assert_eq!(s.client.balance(&b), 500);
}

#[test]
fn gating_setters_without_admin_auth_are_rejected_and_addresses_unchanged() {
    // R4: non-admin (no authorization at all) → host auth failure, stored
    // gating addresses untouched.
    let s = setup();
    let other = Address::generate(&s.env);

    assert!(s.client.try_set_kyc_allowlist(&other).is_err());
    assert!(s.client.try_set_freeze_set(&other).is_err());

    assert_eq!(s.client.kyc_allowlist(), s.kyc_allowlist);
    assert_eq!(s.client.freeze_set(), s.freeze_set);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-138 — artist lockup floor in guard_movement + record_absorbed_leftover
//
// Fixture geometry: ARTIST_RETENTION = 100, ARTIST_LOCKUP_UNTIL =
// 1_790_000_000 — the default Env ledger timestamp is 0, so the artist
// lockup is ACTIVE in every test unless set_timestamp moves past it.
// ─────────────────────────────────────────────────────────────────────────────

/// Mint the artist-lockup fixture: the ARTIST itself holds `amount`.
/// Requires auths to be mocked by the caller.
fn mint_to_artist(s: &Setup, amount: i128) {
    let recipients: Vec<(Address, i128)> = vec![&s.env, (s.artist.clone(), amount)];
    s.client.mint_settle(&s.minter, &recipients);
}

#[test]
fn ae1_artist_lockup_floor_boundary_51_reverts_7_exactly_50_passes() {
    // AE1 / R1, both sides of the boundary: balance 150, floor 100 (retention
    // only, no leftover). 150 − 51 = 99 < 100 → #7 with state intact;
    // 150 − 50 = 100 = floor → exactly-at-floor is ALLOWED (pinned).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);
    let c = Address::generate(&s.env);
    allow(&s, &c); // KYC-clean destination — the only gate left is the floor

    let res = s.client.try_transfer(&s.artist, &mux(&c), &51);
    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));
    assert_eq!(s.client.balance(&s.artist), 150); // state intact
    assert_eq!(s.client.balance(&c), 0);

    s.client.transfer(&s.artist, &mux(&c), &50);
    assert_eq!(s.client.balance(&s.artist), 100);
    assert_eq!(s.client.balance(&c), 50);
}

#[test]
fn ae2_artist_burn_breaching_floor_reverts_7() {
    // AE2 / R1 (burn leg): burn is an outflow too — without this gate the
    // lockup would leak through burn. Same geometry as AE1.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);

    let res = s.client.try_burn(&s.artist, &60);

    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));
    assert_eq!(s.client.balance(&s.artist), 150);
    assert_eq!(s.client.total_supply(), 150);
}

#[test]
fn artist_transfer_from_by_spender_hits_floor_and_consumes_nothing() {
    // R1 (transfer_from leg): the floor binds the FROM side regardless of who
    // spends — a spender pulling from the artist trips #7 exactly the same.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);
    let spender = Address::generate(&s.env);
    let dest = Address::generate(&s.env);
    allow(&s, &dest);
    s.client.approve(&s.artist, &spender, &60, &1000);

    let res = s.client.try_transfer_from(&spender, &s.artist, &dest, &51);

    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));
    assert_eq!(s.client.balance(&s.artist), 150);
    assert_eq!(s.client.balance(&dest), 0);
    assert_eq!(s.client.allowance(&s.artist, &spender), 60); // nothing consumed
}

#[test]
fn ae4_after_lockup_expiry_previously_blocked_transfer_succeeds() {
    // AE4 / R3: the SAME breaching transfer flips from #7 to success once the
    // ledger clock reaches artist_lockup_until (`now < until` — at exactly
    // `until` the floor is already gone).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    let res = s.client.try_transfer(&s.artist, &mux(&c), &51);
    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));

    s.env.ledger().set_timestamp(ARTIST_LOCKUP_UNTIL);

    s.client.transfer(&s.artist, &mux(&c), &51);
    assert_eq!(s.client.balance(&s.artist), 99); // below retention — floor gone
    assert_eq!(s.client.balance(&c), 51);
}

#[test]
fn ae5_recorded_leftover_raises_floor_to_retention_plus_leftover() {
    // AE5 / R5: leftover 30 recorded by the minter BEFORE mint → floor 130.
    // 150 − 21 = 129 < 130 → #7; 150 − 20 = 130 = new floor → passes.
    let s = setup();
    s.env.mock_all_auths();
    assert_eq!(s.client.absorbed_leftover(), 0); // default before recording
    s.client.record_absorbed_leftover(&s.minter, &30);
    assert_eq!(s.client.absorbed_leftover(), 30);
    mint_to_artist(&s, 150);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    let res = s.client.try_transfer(&s.artist, &mux(&c), &21);
    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));
    assert_eq!(s.client.balance(&s.artist), 150);

    s.client.transfer(&s.artist, &mux(&c), &20);
    assert_eq!(s.client.balance(&s.artist), 130);
}

#[test]
fn record_absorbed_leftover_by_non_minter_reverts_unauthorized_minter() {
    // R5: authenticated-but-wrong operator → typed UnauthorizedMinter (same
    // pinned ordering as mint_settle); slot untouched.
    let s = setup();
    s.env.mock_all_auths();
    let mallory = Address::generate(&s.env);

    let res = s.client.try_record_absorbed_leftover(&mallory, &30);

    assert_eq!(res, Err(Ok(Error::UnauthorizedMinter)));
    assert_eq!(s.client.absorbed_leftover(), 0);
}

#[test]
fn record_absorbed_leftover_without_auth_fails_at_host_layer_first() {
    // R5, pinned ordering leg 1: `operator.require_auth()` fires FIRST — an
    // unauthenticated minter gets a host auth error, never a typed one.
    let s = setup();
    let res = s.client.try_record_absorbed_leftover(&s.minter, &30);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn second_record_absorbed_leftover_reverts_9_and_keeps_first_value() {
    // R5: the slot is one-shot — a second record fails #9 and the first
    // recorded value stays authoritative.
    let s = setup();
    s.env.mock_all_auths();
    s.client.record_absorbed_leftover(&s.minter, &30);

    let res = s.client.try_record_absorbed_leftover(&s.minter, &40);

    assert_eq!(res, Err(Ok(Error::LeftoverAlreadyRecorded)));
    assert_eq!(s.client.absorbed_leftover(), 30);
}

#[test]
fn record_absorbed_leftover_after_mint_reverts_already_minted() {
    // R5: the leftover is decided by the offering outcome, strictly pre-mint —
    // once mint_settle has run the window is closed (AlreadyMinted, checked
    // ahead of the one-shot slot).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);

    let res = s.client.try_record_absorbed_leftover(&s.minter, &30);

    assert_eq!(res, Err(Ok(Error::AlreadyMinted)));
    assert_eq!(s.client.absorbed_leftover(), 0);
}

#[test]
fn pinned_order_frozen_artist_wins_over_lockup_floor() {
    // Pinned check order: frozen(from) → frozen(to) → kyc(to) → lockup(from).
    // An artist that is BOTH frozen and breaching the floor reports #6 —
    // freeze (emergency intervention) always wins over lockup.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150);
    let c = Address::generate(&s.env);
    allow(&s, &c);
    freeze_addr(&s, &s.artist);

    let res = s.client.try_transfer(&s.artist, &mux(&c), &51);

    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));
}

#[test]
fn non_artist_holder_moves_freely_below_retention_during_artist_lockup() {
    // R4: the floor binds the ARTIST's position only — an unrelated holder
    // with a balance far below artist_retention empties its account freely
    // while the artist lockup is active.
    let s = setup();
    s.env.mock_all_auths();
    let b = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> = vec![&s.env, (b.clone(), 40)];
    s.client.mint_settle(&s.minter, &recipients);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    s.client.transfer(&b, &mux(&c), &40); // 40 < retention(100) — no floor for b

    assert_eq!(s.client.balance(&b), 0);
    assert_eq!(s.client.balance(&c), 40);
}

#[test]
fn mint_settle_to_non_whitelisted_recipient_still_succeeds_mint_path_ungated() {
    // Documented TOV-140 scope boundary: the mint path (from = None) is NOT
    // gated here — the offering escrow (TOV-159) enforces winner KYC on the
    // bid side. Recipients that are neither whitelisted nor even unfrozen-
    // checked still receive the one-shot distribution.
    let s = setup();
    s.env.mock_all_auths();
    let x = Address::generate(&s.env); // not whitelisted
    let y = Address::generate(&s.env); // not whitelisted AND frozen
    freeze_addr(&s, &y);

    let recipients: Vec<(Address, i128)> = vec![&s.env, (x.clone(), 600), (y.clone(), 400)];
    s.client.mint_settle(&s.minter, &recipients);

    assert_eq!(s.client.balance(&x), 600);
    assert_eq!(s.client.balance(&y), 400);
    assert_eq!(s.client.total_supply(), 1000);
    assert!(s.client.is_minted());
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-139 — treasury lockup floor in guard_movement (same funnel slot as the
// artist arm; floor = TREASURY_RETENTION, no leftover component)
//
// Fixture geometry: TREASURY_RETENTION = 50, TREASURY_LOCKUP_UNTIL =
// 1_795_000_000 — the default Env ledger timestamp is 0, so the treasury
// lockup is ACTIVE in every test unless set_timestamp moves past it.
//
// Existing-test audit (mirrors the TOV-138 artist audit): `s.treasury` never
// receives tokens and never appears as `from` anywhere above — activating the
// treasury arm changes no existing scenario.
// ─────────────────────────────────────────────────────────────────────────────

/// Mint the treasury-lockup fixture: the TREASURY itself holds `amount`.
/// Requires auths to be mocked by the caller.
fn mint_to_treasury(s: &Setup, amount: i128) {
    let recipients: Vec<(Address, i128)> = vec![&s.env, (s.treasury.clone(), amount)];
    s.client.mint_settle(&s.minter, &recipients);
}

#[test]
fn ae3_treasury_holding_exactly_retention_cannot_move_a_single_fraction() {
    // AE3 / R2: treasury balance == retention (the blunt TOV-139 wording as a
    // special case of the floor model) — transfer 1 → #8, state intact.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_treasury(&s, TREASURY_RETENTION);
    let c = Address::generate(&s.env);
    allow(&s, &c); // KYC-clean destination — the only gate left is the floor

    let res = s.client.try_transfer(&s.treasury, &mux(&c), &1);

    assert_eq!(res.err().unwrap(), gating_err(Error::TreasuryLockupViolated));
    assert_eq!(s.client.balance(&s.treasury), TREASURY_RETENTION); // state intact
    assert_eq!(s.client.balance(&c), 0);
    assert_eq!(s.client.total_supply(), TREASURY_RETENTION);
}

#[test]
fn treasury_lockup_floor_boundary_51_reverts_8_exactly_50_passes() {
    // R2, both sides of the boundary (AE1-mirror): balance 100, floor 50.
    // 100 − 51 = 49 < 50 → #8 with state intact; 100 − 50 = 50 = floor →
    // exactly-at-floor is ALLOWED (pinned, same semantics as the artist arm).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_treasury(&s, TREASURY_RETENTION + 50);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    let res = s.client.try_transfer(&s.treasury, &mux(&c), &51);
    assert_eq!(res.err().unwrap(), gating_err(Error::TreasuryLockupViolated));
    assert_eq!(s.client.balance(&s.treasury), 100); // state intact
    assert_eq!(s.client.balance(&c), 0);

    s.client.transfer(&s.treasury, &mux(&c), &50);
    assert_eq!(s.client.balance(&s.treasury), 50);
    assert_eq!(s.client.balance(&c), 50);
}

#[test]
fn treasury_burn_breaching_floor_reverts_8() {
    // R2 (burn leg): burn is an outflow too — without this gate the treasury
    // lockup would leak through burn. 100 − 51 = 49 < 50 → #8.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_treasury(&s, TREASURY_RETENTION + 50);

    let res = s.client.try_burn(&s.treasury, &51);

    assert_eq!(res.err().unwrap(), gating_err(Error::TreasuryLockupViolated));
    assert_eq!(s.client.balance(&s.treasury), 100);
    assert_eq!(s.client.total_supply(), 100);
}

#[test]
fn after_treasury_lockup_expiry_previously_blocked_transfer_succeeds() {
    // AE4-mirror / R3: the SAME breaching transfer flips from #8 to success
    // once the ledger clock reaches treasury_lockup_until (`now < until` — at
    // exactly `until` the floor is already gone).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_treasury(&s, TREASURY_RETENTION);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    let res = s.client.try_transfer(&s.treasury, &mux(&c), &1);
    assert_eq!(res.err().unwrap(), gating_err(Error::TreasuryLockupViolated));

    s.env.ledger().set_timestamp(TREASURY_LOCKUP_UNTIL);

    s.client.transfer(&s.treasury, &mux(&c), &1);
    assert_eq!(s.client.balance(&s.treasury), TREASURY_RETENTION - 1); // floor gone
    assert_eq!(s.client.balance(&c), 1);
}

#[test]
fn artist_and_treasury_floors_operate_independently() {
    // Independence: each floor binds only its own address, on its own clock.
    // Both lockups active; artist balance 150 (floor 100), treasury balance
    // 100 (floor 50).
    let s = setup();
    s.env.mock_all_auths();
    let recipients: Vec<(Address, i128)> = vec![
        &s.env,
        (s.artist.clone(), 150),
        (s.treasury.clone(), TREASURY_RETENTION + 50),
    ];
    s.client.mint_settle(&s.minter, &recipients);
    let c = Address::generate(&s.env);
    allow(&s, &c);

    // Treasury blocked (#8) while the artist moves freely within ITS floor.
    let res = s.client.try_transfer(&s.treasury, &mux(&c), &51);
    assert_eq!(res.err().unwrap(), gating_err(Error::TreasuryLockupViolated));
    s.client.transfer(&s.artist, &mux(&c), &50); // artist at 100 = its floor

    // Artist blocked (#7) while the treasury moves freely within ITS floor.
    let res = s.client.try_transfer(&s.artist, &mux(&c), &1);
    assert_eq!(res.err().unwrap(), gating_err(Error::ArtistLockupViolated));
    s.client.transfer(&s.treasury, &mux(&c), &50); // treasury at 50 = its floor

    assert_eq!(s.client.balance(&s.artist), 100);
    assert_eq!(s.client.balance(&s.treasury), 50);
    assert_eq!(s.client.balance(&c), 100);
}

#[test]
fn pinned_order_frozen_treasury_wins_over_lockup_floor() {
    // Pinned check order: frozen(from) → frozen(to) → kyc(to) → lockup(from).
    // A treasury that is BOTH frozen and breaching the floor reports #6 —
    // freeze (emergency intervention) always wins over lockup, same as the
    // artist arm.
    let s = setup();
    s.env.mock_all_auths();
    mint_to_treasury(&s, TREASURY_RETENTION);
    let c = Address::generate(&s.env);
    allow(&s, &c);
    freeze_addr(&s, &s.treasury);

    let res = s.client.try_transfer(&s.treasury, &mux(&c), &1);

    assert_eq!(res.err().unwrap(), gating_err(Error::Frozen));
}

// ─────────────────────────────────────────────────────────────────────────────
// TOV-143 — settle_trade: atomic fraction↔USDC settlement with 1.5% platform +
// 1.5% royalty split (REAL SAC in the Env; settler = plain mocked Address — the
// invoker-contract auth pattern is exercised the same way require_auth always
// is in tests)
// ─────────────────────────────────────────────────────────────────────────────

/// Standard settle fixture on top of [`mint_fixture`]: seller = `a` (600
/// fractions), plus a FRESH whitelisted buyer funded with `usdc_amount` USDC
/// (skipped when 0). Requires auths to be mocked by the caller.
pub(crate) fn settle_fixture(s: &Setup, usdc_amount: i128) -> (Address, Address) {
    let (seller, _b) = mint_fixture(s);
    let buyer = Address::generate(&s.env);
    allow(s, &buyer);
    if usdc_amount > 0 {
        fund_usdc(s, &buyer, usdc_amount);
    }
    (seller, buyer)
}

#[test]
fn ae1_settle_trade_exact_split_moves_fractions_usdc_and_emits_event() {
    // AE1 / R2+R4: gross 10_000 → platform 150 (1.5% floor) to treasury,
    // royalty 150 (1.5% floor) to artist_payout, remainder 9_700 to the seller;
    // `count` fractions seller→buyer; trade.settled decoded exact.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);
    // The buyer's USDC `require_auth` fires in a NON-ROOT frame (token → SAC
    // transfer) — on-chain that is the buyer auth entry the settler assembles
    // into the transaction; in tests it needs the non-root-allowing mock.
    s.env.mock_all_auths_allowing_non_root_auth();

    s.client.settle_trade(&buyer, &seller, &25, &10_000);

    // The TOKEN's own events for the invocation, decoded exact (the three SAC
    // transfer legs ride under the USDC contract id and are filtered out):
    // the SEP-41 transfer for the fraction leg, then trade.settled — topics
    // ["trade", "settled", buyer, seller] (the 4-topic cap spends the two
    // free slots on the parties), split figures in the data map.
    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "count"), 25_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "gross_usdc"), 10_000_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "platform_cut"), 150_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "artist_cut"), 150_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "seller_net"), 9_700_i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.id),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "transfer").into_val(&s.env),
                    seller.into_val(&s.env),
                    buyer.into_val(&s.env),
                ],
                25_i128.into_val(&s.env),
            ),
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "trade").into_val(&s.env),
                    Symbol::new(&s.env, "settled").into_val(&s.env),
                    buyer.into_val(&s.env),
                    seller.into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );

    // Fraction leg: 25 moved seller→buyer, supply untouched.
    assert_eq!(s.client.balance(&seller), 575);
    assert_eq!(s.client.balance(&buyer), 25);
    assert_eq!(s.client.total_supply(), 1000);

    // USDC legs: all three balances exact, buyer fully debited.
    assert_eq!(usdc_balance(&s, &s.treasury), 150);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 150);
    assert_eq!(usdc_balance(&s, &seller), 9_700);
    assert_eq!(usdc_balance(&s, &buyer), 0);
}

#[test]
fn ae2_settle_trade_rounding_10001_sums_to_gross_zero_dust() {
    // AE2 / R2 (rounding): gross 10_001 → floor cuts 150 + 150, remainder
    // 9_701 to the seller — 150 + 150 + 9_701 == 10_001, zero dust.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_001);
    s.env.mock_all_auths_allowing_non_root_auth(); // buyer auth in non-root frame

    s.client.settle_trade(&buyer, &seller, &10, &10_001);

    assert_eq!(usdc_balance(&s, &s.treasury), 150);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 150);
    assert_eq!(usdc_balance(&s, &seller), 9_701);
    assert_eq!(usdc_balance(&s, &buyer), 0);
    assert_eq!(150 + 150 + 9_701, 10_001); // the split IS the gross
}

#[test]
fn ae3_settle_trade_without_settler_auth_fails_at_host_layer_and_moves_nothing() {
    // AE3 / R1: the gate is `require_auth()` on the STORED settler address —
    // a non-settler caller simply means NO authorization exists for that
    // address, so the failure is a HOST auth error, pinned honestly as
    // Err(Err(_)) (an invoke error, never a typed contract error), with
    // nothing moved. The authenticated-settler happy path is every other
    // test in this section.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);
    s.env.set_auths(&[]); // enforcing mode: nobody authorizes anything

    let res = s.client.try_settle_trade(&buyer, &seller, &25, &10_000);

    assert!(matches!(res, Err(Err(_))));
    s.env.mock_all_auths();
    assert_eq!(s.client.balance(&seller), 600);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 0);
}

#[test]
fn ae4_settle_trade_seller_artist_breaching_lockup_floor_reverts_7_usdc_untouched() {
    // AE4 / R3: settlement runs the FULL compliance funnel — an artist-seller
    // whose sale would breach the active lockup floor (150 − 51 = 99 < 100)
    // trips #7 and NO USDC moves (the guard fires before any leg).
    let s = setup();
    s.env.mock_all_auths();
    mint_to_artist(&s, 150); // floor 100, lockup active (ledger ts 0)
    let buyer = Address::generate(&s.env);
    allow(&s, &buyer);
    fund_usdc(&s, &buyer, 10_000);

    let res = s.client.try_settle_trade(&buyer, &s.artist, &51, &10_000);

    assert_eq!(res, Err(Ok(Error::ArtistLockupViolated)));
    assert_eq!(s.client.balance(&s.artist), 150);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 0);
    assert_eq!(usdc_balance(&s, &s.artist), 0);
}

#[test]
fn ae5_settle_trade_buyer_short_on_usdc_reverts_whole_settlement() {
    // AE5 / R2 (atomicity): the fraction leg runs BEFORE the USDC legs; the
    // buyer covers the 200 + 500 cuts but not the 9_300 seller leg — the
    // failing third leg rolls the WHOLE settlement back: fractions unmoved,
    // every USDC balance untouched (host atomicity).
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 5_000); // funded BELOW gross
    // Non-root mock so the failure below is GENUINELY the balance shortfall
    // on the third USDC leg, not a test-env auth artifact.
    s.env.mock_all_auths_allowing_non_root_auth();

    let res = s.client.try_settle_trade(&buyer, &seller, &25, &10_000);

    assert!(res.is_err());
    assert_eq!(s.client.balance(&seller), 600); // fraction leg rolled back
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 5_000);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 0);
    assert_eq!(usdc_balance(&s, &seller), 0);
}

#[test]
fn settle_trade_gross_zero_moves_fractions_and_skips_all_usdc_legs() {
    // Pinned decision: zero-amount USDC legs are SKIPPED — a SAC transfer of
    // 0 would succeed, but skipping saves the cross-contract calls, so a
    // gross-0 settlement (gift/comp trade, still fully gated) never touches
    // the SAC at all. The event stream proves it: exactly TWO events — the
    // SEP-41 transfer and trade.settled — and no SAC event in between.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 0);

    s.client.settle_trade(&buyer, &seller, &40, &0);

    let mut data = Map::<Symbol, Val>::new(&s.env);
    data.set(Symbol::new(&s.env, "count"), 40_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "gross_usdc"), 0_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "platform_cut"), 0_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "artist_cut"), 0_i128.into_val(&s.env));
    data.set(Symbol::new(&s.env, "seller_net"), 0_i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "transfer").into_val(&s.env),
                    seller.into_val(&s.env),
                    buyer.into_val(&s.env),
                ],
                40_i128.into_val(&s.env),
            ),
            (
                s.id.clone(),
                vec![
                    &s.env,
                    Symbol::new(&s.env, "trade").into_val(&s.env),
                    Symbol::new(&s.env, "settled").into_val(&s.env),
                    buyer.into_val(&s.env),
                    seller.into_val(&s.env),
                ],
                data.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.client.balance(&seller), 560);
    assert_eq!(s.client.balance(&buyer), 40);
    assert_eq!(s.client.total_supply(), 1000);
    assert_eq!(usdc_balance(&s, &buyer), 0);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 0);
    assert_eq!(usdc_balance(&s, &seller), 0);
}

#[test]
fn settle_trade_invalid_inputs_revert_10_and_move_nothing() {
    // R5: count 0, negative count, negative gross, and buyer == seller all
    // revert with the typed InvalidTrade (#10) — validated AFTER the settler
    // gate, BEFORE the guard funnel — and nothing moves.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);

    assert_eq!(
        s.client.try_settle_trade(&buyer, &seller, &0, &10_000),
        Err(Ok(Error::InvalidTrade))
    );
    assert_eq!(
        s.client.try_settle_trade(&buyer, &seller, &-5, &10_000),
        Err(Ok(Error::InvalidTrade))
    );
    assert_eq!(
        s.client.try_settle_trade(&buyer, &seller, &25, &-1),
        Err(Ok(Error::InvalidTrade))
    );
    assert_eq!(
        s.client.try_settle_trade(&seller, &seller, &25, &10_000),
        Err(Ok(Error::InvalidTrade))
    );

    assert_eq!(s.client.balance(&seller), 600);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
}

#[test]
fn settle_trade_to_non_whitelisted_buyer_reverts_5_nothing_moves() {
    // R3 (KYC leg): the buyer is the movement's recipient — a non-whitelisted
    // buyer trips #5 through the same funnel as a plain transfer.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, _b) = mint_fixture(&s);
    let buyer = Address::generate(&s.env); // never whitelisted
    fund_usdc(&s, &buyer, 10_000);

    let res = s.client.try_settle_trade(&buyer, &seller, &25, &10_000);

    assert_eq!(res, Err(Ok(Error::RecipientNotWhitelisted)));
    assert_eq!(s.client.balance(&seller), 600);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
}

#[test]
fn settle_trade_with_frozen_seller_reverts_6_nothing_moves() {
    // R3 (freeze leg): a frozen seller blocks settlement with #6 — freeze
    // wins over everything else in the pinned funnel order.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);
    freeze_addr(&s, &seller);

    let res = s.client.try_settle_trade(&buyer, &seller, &25, &10_000);

    assert_eq!(res, Err(Ok(Error::Frozen)));
    assert_eq!(s.client.balance(&seller), 600);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
}

#[test]
fn settle_trade_seller_insufficient_fractions_fails_atomically_usdc_untouched() {
    // R2 (atomicity, fraction side): seller holds 600, count 700 — the OZ
    // InsufficientBalance fires INSIDE Base::update, after the compliance
    // funnel and before any USDC leg; the settlement aborts with nothing
    // moved on either side.
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);

    let res = s.client.try_settle_trade(&buyer, &seller, &700, &10_000);

    assert!(res.is_err());
    assert_eq!(s.client.balance(&seller), 600);
    assert_eq!(s.client.balance(&buyer), 0);
    assert_eq!(usdc_balance(&s, &buyer), 10_000);
    assert_eq!(usdc_balance(&s, &s.treasury), 0);
    assert_eq!(usdc_balance(&s, &s.artist_payout), 0);
}
