// `String` must stay in scope even though no hand-written fn names it: the
// `#[contractimpl(contracttrait)]` expansion generates the non-overridden
// trait defaults (`name`, `symbol`) here.
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, vec, xdr::ToXdr, Address, Bytes, BytesN, Env,
    IntoVal, MuxedAddress, String, Symbol, Vec,
};
use stellar_contract_utils::upgradeable::{self as upgradeable};
use stellar_tokens::fungible::{burnable::FungibleBurnable, emit_transfer, Base, FungibleToken};

use crate::error::Error;
use crate::events::{GatingUpdated, MigrationCompleted, ProxyUpgraded, TradeSettled};
use crate::storage::{extend_instance_ttl, DataKey, InvariantSnapshot, TokenInit};

/// Royalty share routed to the artist on secondary settlement, in basis
/// points. Compile-time constant by design (AE3): there is no storage slot,
/// no constructor argument, and no setter — the value can only change with a
/// new canonical WASM (TOV-146), never per deployment.
pub const ROYALTY_BPS: u32 = 150;
/// Platform fee share on secondary settlement, in basis points. Same
/// compile-time regime as [`ROYALTY_BPS`].
pub const PLATFORM_FEE_BPS: u32 = 150;

/// Storage schema this executable understands. Bump only together with a
/// `migrate` transform (OZ eager pattern, stellar-contract-utils upgradeable).
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[contract]
pub struct FractionToken;

/// Movement-guard seam — the single funnel every balance movement passes
/// through BEFORE delegating to the OZ `Base` implementation. Callers:
///
/// - `transfer` / `transfer_from` — `from = Some`, `to = Some`
/// - `burn` / `burn_from`         — `from = Some`, `to = None`
/// - `mint_settle`                — `from = None`, `to = Some` (per recipient)
/// - `settle_trade` (TOV-143)     — `from = Some(seller)`, `to = Some(buyer)`
///
/// TOV-140 fills the funnel with hybrid KYC gating; TOV-138 appends the
/// artist lockup floor; TOV-150 prepends the migration-pending seal. Pinned
/// check order (test-pinned, compliance errors — freeze, then KYC — win over
/// lockup in error reporting):
///
/// 0. migration pending → [`Error::MigrationPending`] — FIRST, ahead of
///    everything (even the mint-path early return): while an upgrade awaits
///    `migrate`, no executable — verified or not — moves a single fraction.
/// 1. `is_frozen(from)` → [`Error::Frozen`]
/// 2. `is_frozen(to)`   → [`Error::Frozen`] (transfers only — burn has no `to`)
/// 3. `is_allowed(to)`  → [`Error::RecipientNotWhitelisted`] if false
/// 4. lockup floor on `from` → [`check_lockup_floor`]
///    ([`Error::ArtistLockupViolated`] / [`Error::TreasuryLockupViolated`])
///
/// The mint path (`from = None`) is UNCHECKED past step 0 by ticket scope: the
/// offering escrow (TOV-159) enforces winner KYC on the bid side, so
/// `mint_settle` can distribute to any recipient.
///
/// Gating reads are DYNAMIC cross-contract invocations against the STORED
/// `KycAllowlist` / `FreezeSet` addresses — no crate dependency on the gating
/// contracts (a path-dep would drag their `__constructor` exports into this
/// WASM link, the TOV-137 symbol-collision lesson), and no local caching:
/// allowlist/freeze changes take effect on the very next movement. A dead or
/// trapping gating contract makes the movement trap too — deliberately
/// fail-closed (no gating ⇒ no movement).
///
/// Repo rule (review-enforced): no balance-moving entrypoint may bypass this
/// funnel, and `Base::mint` is never called outside `mint_settle`.
fn guard_movement(e: &Env, from: Option<&Address>, to: Option<&Address>, amount: i128) {
    // TOV-150 seal — before ANYTHING, including the mint-path early return:
    // a pending migration blocks every movement, defense-in-depth on top of
    // the typed checks in `mint_settle`/`record_absorbed_leftover`.
    if migration_pending(e) {
        panic_with_error!(e, Error::MigrationPending);
    }

    // Mint path (from = None): unchecked by TOV-140 scope (see doc above).
    let Some(from) = from else {
        return;
    };

    let freeze_set: Address = e.storage().instance().get(&DataKey::FreezeSet).unwrap();
    if gate_check(e, &freeze_set, "is_frozen", from) {
        panic_with_error!(e, Error::Frozen);
    }
    if let Some(to) = to {
        if gate_check(e, &freeze_set, "is_frozen", to) {
            panic_with_error!(e, Error::Frozen);
        }
        let kyc: Address = e.storage().instance().get(&DataKey::KycAllowlist).unwrap();
        if !gate_check(e, &kyc, "is_allowed", to) {
            panic_with_error!(e, Error::RecipientNotWhitelisted);
        }
    }
    check_lockup_floor(e, from, amount);
}

/// Lockup-floor check on the OUTFLOW side of a movement (TOV-138/139,
/// FR-04.06/07). Runs LAST in the pinned `guard_movement` order — after
/// frozen(from) → frozen(to) → kyc(to) — so compliance errors win.
///
/// Floor model (plan decision): the lockup pins a *retention position*, not
/// the address — fractions above the floor stay freely movable during the
/// lockup, and after `lockup_until` the floor vanishes entirely. Burn goes
/// through the same check (a burn is an outflow too; otherwise the lockup
/// leaks through `burn`/`burn_from`).
///
/// Artist floor = `artist_retention + absorbed_leftover` (default 0 until
/// `record_absorbed_leftover`, TOV-159). Treasury floor = `treasury_retention`
/// until `treasury_lockup_until` (TOV-139) — the two floors are independent:
/// each binds only its own address, on its own clock.
fn check_lockup_floor(e: &Env, from: &Address, amount: i128) {
    let artist: Address = e.storage().instance().get(&DataKey::Artist).unwrap();
    let treasury: Address = e.storage().instance().get(&DataKey::Treasury).unwrap();
    match from {
        f if *f == artist => {
            let until: u64 =
                e.storage().instance().get(&DataKey::ArtistLockupUntil).unwrap();
            if e.ledger().timestamp() < until {
                let retention: i128 =
                    e.storage().instance().get(&DataKey::ArtistRetention).unwrap();
                let leftover: i128 = e
                    .storage()
                    .instance()
                    .get(&DataKey::ArtistAbsorbedLeftover)
                    .unwrap_or(0);
                if Base::balance(e, from) - amount < retention + leftover {
                    panic_with_error!(e, Error::ArtistLockupViolated);
                }
            }
        }
        f if *f == treasury => {
            let until: u64 =
                e.storage().instance().get(&DataKey::TreasuryLockupUntil).unwrap();
            if e.ledger().timestamp() < until {
                let retention: i128 =
                    e.storage().instance().get(&DataKey::TreasuryRetention).unwrap();
                if Base::balance(e, from) - amount < retention {
                    panic_with_error!(e, Error::TreasuryLockupViolated);
                }
            }
        }
        _ => {}
    }
}

/// One dynamic `bool(fn_name(addr))` read against a gating contract
/// (`is_frozen` on the freeze set, `is_allowed` on the KYC allowlist).
fn gate_check(e: &Env, gating: &Address, fn_name: &str, party: &Address) -> bool {
    e.invoke_contract::<bool>(gating, &Symbol::new(e, fn_name), vec![e, party.into_val(e)])
}

fn proxy_admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::ProxyAdmin).unwrap()
}

/// Whether an `upgrade` is awaiting a successful `migrate` (TOV-150).
fn migration_pending(e: &Env) -> bool {
    e.storage().instance().has(&DataKey::MigrationPending)
}

fn require_proxy_admin(e: &Env) {
    proxy_admin(e).require_auth();
}

/// SHA-256 fingerprint of the WRITE-ONCE economic config slots — the set a
/// rogue interim executable could repoint (supply-preserving) but that a
/// legitimate admin never mutates. Recorded in the [`InvariantSnapshot`] by
/// `upgrade` and re-checked by `migrate`, so a corrupt-then-recover attack
/// cannot launder a config change through the gate. The SAME function computes
/// the recorded and the checked value, so the two can never drift.
///
/// Deliberately EXCLUDES the admin-rotatable slots (`ProxyAdmin`,
/// `KycAllowlist`, `FreezeSet` — each has a setter, so an admin may legitimately
/// change them while a migration is pending; snapshotting them would false-
/// reject a valid rotation) and per-holder balances (uncoverable by a cheap
/// snapshot). Those rest on the admin multi-sig + the TOV-146 canonical-hash
/// review of every upgrade. Lockups are covered separately (their own snapshot
/// arms enforce monotonicity, not equality).
pub(crate) fn config_digest(e: &Env) -> BytesN<32> {
    let s = e.storage().instance();
    let mut buf = Bytes::new(e);
    let artwork_id: BytesN<32> = s.get(&DataKey::ArtworkId).unwrap();
    buf.append(&artwork_id.to_xdr(e));
    let artist: Address = s.get(&DataKey::Artist).unwrap();
    buf.append(&artist.to_xdr(e));
    let artist_payout: Address = s.get(&DataKey::ArtistPayout).unwrap();
    buf.append(&artist_payout.to_xdr(e));
    let treasury: Address = s.get(&DataKey::Treasury).unwrap();
    buf.append(&treasury.to_xdr(e));
    let settler: Address = s.get(&DataKey::MarketplaceSettler).unwrap();
    buf.append(&settler.to_xdr(e));
    let minter: Address = s.get(&DataKey::Minter).unwrap();
    buf.append(&minter.to_xdr(e));
    let usdc: Address = s.get(&DataKey::Usdc).unwrap();
    buf.append(&usdc.to_xdr(e));
    let artist_retention: i128 = s.get(&DataKey::ArtistRetention).unwrap();
    buf.append(&artist_retention.to_xdr(e));
    let treasury_retention: i128 = s.get(&DataKey::TreasuryRetention).unwrap();
    buf.append(&treasury_retention.to_xdr(e));
    // Absent ⇒ 0 (no under-subscription leftover absorbed yet).
    let absorbed_leftover: i128 = s.get(&DataKey::ArtistAbsorbedLeftover).unwrap_or(0);
    buf.append(&absorbed_leftover.to_xdr(e));
    e.crypto().sha256(&buf).to_bytes()
}

#[contractimpl]
impl FractionToken {
    /// Bind all write-once per-artwork parameters, set the SEP-41 metadata
    /// (decimals = 0: fractions are whole units), record the initial
    /// implementation WASM hash, and stamp schema version 1. Runs exactly
    /// once at deploy; a WASM upgrade never re-runs it.
    pub fn __constructor(e: &Env, init: TokenInit) {
        Base::set_metadata(e, 0, init.name, init.symbol);

        let storage = e.storage().instance();
        storage.set(&DataKey::ArtworkId, &init.artwork_id);
        storage.set(&DataKey::ProxyAdmin, &init.proxy_admin);
        storage.set(&DataKey::Artist, &init.artist);
        storage.set(&DataKey::ArtistPayout, &init.artist_payout);
        storage.set(&DataKey::Treasury, &init.treasury);
        storage.set(&DataKey::ArtistRetention, &init.artist_retention);
        storage.set(&DataKey::ArtistLockupUntil, &init.artist_lockup_until);
        storage.set(&DataKey::TreasuryRetention, &init.treasury_retention);
        storage.set(&DataKey::TreasuryLockupUntil, &init.treasury_lockup_until);
        storage.set(&DataKey::KycAllowlist, &init.kyc_allowlist);
        storage.set(&DataKey::FreezeSet, &init.freeze_set);
        storage.set(&DataKey::MarketplaceSettler, &init.marketplace_settler);
        storage.set(&DataKey::Minter, &init.minter);
        storage.set(&DataKey::Usdc, &init.usdc);
        storage.set(&DataKey::ImplWasmHash, &init.impl_wasm_hash);

        upgradeable::set_schema_version(e, CURRENT_SCHEMA_VERSION);
        extend_instance_ttl(e);
    }

    // ── One-shot initial distribution ────────────────────────────────────────

    /// Mint the initial distribution to `recipients`, exactly once for the
    /// lifetime of the artwork. Only the configured `minter` (offering
    /// escrow) may execute it; OZ `Base::mint` has NO authorization of its
    /// own, so this wrapper is the only permitted call site (repo rule).
    /// Emits one SEP-41 `mint` event per recipient.
    ///
    /// Pinned failure ordering (test-pinned):
    /// 1. `operator.require_auth()` — host auth failure fires FIRST; an
    ///    unauthenticated caller never reaches the typed errors.
    /// 2. migration pending → [`Error::MigrationPending`] (typed — this fn
    ///    returns `Result`, unlike the panic seal in `guard_movement`). The
    ///    pending seal outranks EVERY other typed check: while an upgrade
    ///    awaits `migrate`, the entrypoint is sealed regardless of operator
    ///    or mint state. TOV-150.
    /// 3. `operator != minter` → [`Error::UnauthorizedMinter`] (typed error
    ///    for an authenticated-but-wrong operator).
    /// 4. already executed → [`Error::AlreadyMinted`].
    /// 5. empty `recipients` → [`Error::EmptyMint`] (flag stays unset).
    pub fn mint_settle(
        e: &Env,
        operator: Address,
        recipients: Vec<(Address, i128)>,
    ) -> Result<(), Error> {
        operator.require_auth();
        if migration_pending(e) {
            return Err(Error::MigrationPending);
        }
        let minter: Address = e.storage().instance().get(&DataKey::Minter).unwrap();
        if operator != minter {
            return Err(Error::UnauthorizedMinter);
        }
        if e.storage().instance().has(&DataKey::MintDone) {
            return Err(Error::AlreadyMinted);
        }
        if recipients.is_empty() {
            return Err(Error::EmptyMint);
        }

        for (to, amount) in recipients.iter() {
            if amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            guard_movement(e, None, Some(&to), amount);
            Base::mint(e, &to, amount);
        }

        e.storage().instance().set(&DataKey::MintDone, &true);
        extend_instance_ttl(e);
        Ok(())
    }

    /// Record the under-subscription leftover the artist absorbs (TOV-138,
    /// slot filled for real by the offering escrow, TOV-159). Raises the
    /// artist lockup floor to `artist_retention + amount`. One-shot,
    /// minter-only, and only while the initial distribution has NOT run yet
    /// (the leftover is decided by the offering outcome, i.e. strictly
    /// pre-mint).
    ///
    /// Pinned failure ordering (mirrors `mint_settle`, test-pinned):
    /// 1. `operator.require_auth()` — host auth failure fires FIRST.
    /// 2. migration pending → [`Error::MigrationPending`] (typed; outranks
    ///    every other typed check — same seal position as `mint_settle`).
    /// 3. `operator != minter` → [`Error::UnauthorizedMinter`].
    /// 4. mint already done → [`Error::AlreadyMinted`].
    /// 5. already recorded → [`Error::LeftoverAlreadyRecorded`].
    pub fn record_absorbed_leftover(
        e: &Env,
        operator: Address,
        amount: i128,
    ) -> Result<(), Error> {
        operator.require_auth();
        if migration_pending(e) {
            return Err(Error::MigrationPending);
        }
        let minter: Address = e.storage().instance().get(&DataKey::Minter).unwrap();
        if operator != minter {
            return Err(Error::UnauthorizedMinter);
        }
        if e.storage().instance().has(&DataKey::MintDone) {
            return Err(Error::AlreadyMinted);
        }
        if e.storage().instance().has(&DataKey::ArtistAbsorbedLeftover) {
            return Err(Error::LeftoverAlreadyRecorded);
        }
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        e.storage().instance().set(&DataKey::ArtistAbsorbedLeftover, &amount);
        extend_instance_ttl(e);
        Ok(())
    }

    // ── Atomic secondary-trade settlement (TOV-143, FR-04.09) ───────────────

    /// Settle one secondary trade atomically: `count` fractions seller→buyer
    /// plus `gross_usdc` buyer→(treasury 1.5%, artist_payout 1.5%, seller rest).
    /// Only the stored `marketplace_settler` may invoke — when the settler is
    /// a contract (TOV-179), its `require_auth` is satisfied automatically by
    /// the invoker-contract auth frame; any other caller fails host auth.
    ///
    /// AUTH MODEL (plan decision, binding): the token does NOT require the
    /// seller's (or buyer's, for the fraction leg) signature — verifying the
    /// signed trade intents is the MarketplaceSettler's job (TOV-179), and
    /// trusting that caller-gate is this entrypoint's reason to exist. The
    /// fraction move therefore uses the internal OZ path (`Base::update` +
    /// `emit_transfer`) AFTER the full `guard_movement` compliance funnel —
    /// KYC/freeze/lockup floors are enforced exactly as on `transfer` (a
    /// locked artist retention cannot be sold through settlement either).
    /// The buyer's USDC spend IS authorized by the buyer: the three
    /// `usdc.transfer(buyer, …)` legs require buyer auth entries assembled
    /// into the settler's transaction.
    ///
    /// Split math (zero dust, floor rounding): `platform_cut =
    /// gross*PLATFORM_FEE_BPS/10_000`, `artist_cut = gross*ROYALTY_BPS/10_000`,
    /// `seller_net = gross − platform_cut − artist_cut` — the rounding
    /// remainder goes to the seller in full, and the three legs always sum to
    /// exactly `gross_usdc`.
    ///
    /// Pinned behaviors (test-pinned):
    /// - `settler.require_auth()` fires FIRST — an unauthenticated caller
    ///   never reaches the typed errors.
    /// - Migration pending seals settlement too — inherited from
    ///   `guard_movement` step 0, so it surfaces AFTER the parameter
    ///   validation below: auth → `InvalidTrade` → `MigrationPending`.
    ///   TOV-150.
    /// - `count <= 0`, `gross_usdc < 0`, or `buyer == seller` →
    ///   [`Error::InvalidTrade`]. Gross 0 is VALID: the fraction leg still
    ///   runs fully gated; all three USDC legs are skipped.
    /// - Zero-amount USDC legs are SKIPPED (a SAC transfer of 0 would
    ///   succeed, but skipping saves the cross-contract call and keeps a
    ///   gross-0 settlement free of USDC touchpoints entirely).
    /// - Any failing leg (compliance, fraction balance, any USDC transfer)
    ///   aborts the whole settlement — host atomicity, nothing moves.
    /// - Event order: SEP-41 `transfer` (fraction leg), the USDC SAC events,
    ///   then `trade.settled` with the exact split.
    pub fn settle_trade(
        e: &Env,
        buyer: Address,
        seller: Address,
        count: i128,
        gross_usdc: i128,
    ) -> Result<(), Error> {
        let settler: Address =
            e.storage().instance().get(&DataKey::MarketplaceSettler).unwrap();
        settler.require_auth();

        if count <= 0 || gross_usdc < 0 || buyer == seller {
            return Err(Error::InvalidTrade);
        }

        // Full compliance funnel — same seam as every other movement:
        // frozen(seller) → frozen(buyer) → kyc(buyer) → lockup floor(seller).
        guard_movement(e, Some(&seller), Some(&buyer), count);

        // Fraction leg via the internal OZ path: `Base::update` moves the
        // balance WITHOUT any require_auth (see AUTH MODEL above);
        // `emit_transfer` keeps the SEP-41 event surface identical to a
        // normal transfer (`to_muxed_id = None` → bare SEP-41 shape).
        Base::update(e, Some(&seller), Some(&buyer), count);
        emit_transfer(e, &seller, &buyer, None, count);

        // USDC legs on the stored SAC. i128 math on BPS constants (u32 by
        // ABI, cast up); floor division, remainder to the seller.
        let platform_cut = gross_usdc * (PLATFORM_FEE_BPS as i128) / 10_000;
        let artist_cut = gross_usdc * (ROYALTY_BPS as i128) / 10_000;
        let seller_net = gross_usdc - platform_cut - artist_cut;

        if gross_usdc > 0 {
            let usdc_addr: Address = e.storage().instance().get(&DataKey::Usdc).unwrap();
            let usdc = token::TokenClient::new(e, &usdc_addr);
            let treasury: Address = e.storage().instance().get(&DataKey::Treasury).unwrap();
            let artist_payout: Address =
                e.storage().instance().get(&DataKey::ArtistPayout).unwrap();
            if platform_cut > 0 {
                usdc.transfer(&buyer, &treasury, &platform_cut);
            }
            if artist_cut > 0 {
                usdc.transfer(&buyer, &artist_payout, &artist_cut);
            }
            if seller_net > 0 {
                usdc.transfer(&buyer, &seller, &seller_net);
            }
        }

        TradeSettled { buyer, seller, count, gross_usdc, platform_cut, artist_cut, seller_net }
            .publish(e);
        extend_instance_ttl(e);
        Ok(())
    }

    // ── Upgrade seam (R1/R2/R6 — full invariant comparison in TOV-151) ──────

    /// Swap the executable to `new_wasm_hash` in place: same address, storage
    /// untouched, constructor not re-run. Admin-gated (`proxy_admin`), per
    /// FR-04.14 — unlike the wallet's self-auth upgrade. Emits
    /// `proxy.upgraded(old_wasm_hash, new_wasm_hash)`.
    ///
    /// TOV-150: BEFORE the swap, records the [`InvariantSnapshot`] (supply,
    /// both lockups, mint flag — read by the still-trusted OLD executable)
    /// and raises the `MigrationPending` seal: from this transaction on,
    /// every balance movement reverts `#11` until `migrate()` verifies the
    /// new executable.
    ///
    /// PINNED (security decision): if a migration is ALREADY pending, a
    /// further upgrade keeps the FIRST snapshot — that snapshot is the
    /// pre-incident baseline, and re-recording here would launder whatever a
    /// rogue interim executable did into the new baseline. The wasm swap,
    /// `proxy.upgraded` event, and `ImplWasmHash` update still happen (this
    /// IS the recovery path: upgrade back to the canonical WASM, then
    /// migrate against the original baseline).
    ///
    /// The host applies the WASM swap only after this invocation completes
    /// successfully, so the event and the `ImplWasmHash` update below are
    /// recorded by the OLD executable in the same transaction.
    pub fn upgrade(e: &Env, new_wasm_hash: BytesN<32>) {
        require_proxy_admin(e);
        let old_wasm_hash: BytesN<32> =
            e.storage().instance().get(&DataKey::ImplWasmHash).unwrap();

        if !migration_pending(e) {
            let snapshot = InvariantSnapshot {
                total_supply: Base::total_supply(e),
                artist_lockup_until: e
                    .storage()
                    .instance()
                    .get(&DataKey::ArtistLockupUntil)
                    .unwrap(),
                treasury_lockup_until: e
                    .storage()
                    .instance()
                    .get(&DataKey::TreasuryLockupUntil)
                    .unwrap(),
                minted: e.storage().instance().has(&DataKey::MintDone),
                config_digest: config_digest(e),
            };
            e.storage().instance().set(&DataKey::InvariantSnapshot, &snapshot);
            e.storage().instance().set(&DataKey::MigrationPending, &true);
        }

        upgradeable::upgrade(e, &new_wasm_hash);

        e.storage().instance().set(&DataKey::ImplWasmHash, &new_wasm_hash);
        ProxyUpgraded { old_wasm_hash, new_wasm_hash }.publish(e);
        extend_instance_ttl(e);
    }

    /// Post-upgrade invariant gate, executed by the NEW executable.
    /// Admin-gated.
    ///
    /// Pinned semantics (test-pinned, keep stable):
    /// - **Migration pending** (the TOV-150/151 arm), pinned CHECK ORDER:
    ///   1. this executable's own economic constants (`ROYALTY_BPS == 150 &&
    ///      PLATFORM_FEE_BPS == 150` — trivially true for THIS canonical
    ///      build; the arm exists so an evil executable with different
    ///      constants fails here, proven with the real
    ///      `tove-evil-fraction-token` fixture in TOV-151);
    ///   2. live state vs the stored [`InvariantSnapshot`] (TOV-151):
    ///      `total_supply` EQUAL, `ArtistLockupUntil` / `TreasuryLockupUntil`
    ///      NOT DECREASED (`>=` — extending a lockup is legitimate, cutting
    ///      it short never is), `MintDone` presence EQUAL, and the WRITE-ONCE
    ///      economic config fingerprint EQUAL (`config_digest` — ArtworkId,
    ///      Artist, ArtistPayout, Treasury, MarketplaceSettler, Minter, Usdc,
    ///      retentions, absorbed leftover). The comparison reads the raw
    ///      storage slots, not module-level getters, so a rogue interim
    ///      executable cannot have satisfied the gate by shadowing accessors —
    ///      only by not touching the state.
    ///   ANY mismatch → [`Error::InvariantViolated`], with the pending seal
    ///   AND the snapshot RETAINED — funds stay sealed and the baseline
    ///   stays available for a later recovery attempt (upgrade back to the
    ///   canonical WASM). Consequence, pinned by test: any corruption of
    ///   supply, lockups, the mint flag, OR a write-once economic config slot
    ///   can NEVER pass this gate, not even on the canonical build —
    ///   sealed-forever beats laundering the corruption (manual remediation =
    ///   a bespoke migrate in a future canonical WASM).
    ///   SCOPE (honest): this gate does NOT cover the admin-rotatable slots
    ///   (`ProxyAdmin` / `KycAllowlist` / `FreezeSet`, which have setters and
    ///   may change legitimately mid-pending) or per-holder balances (too
    ///   expensive to snapshot). Their integrity rests on the admin multi-sig
    ///   and the TOV-146 canonical-hash review of every signed upgrade.
    ///   On pass → remove the pending seal + snapshot, stamp
    ///   `set_schema_version(CURRENT)`, emit `migration.completed(schema)` —
    ///   movement is live again.
    /// - **No pending** (pre-TOV-150 behavior, unchanged): stored schema
    ///   version == [`CURRENT_SCHEMA_VERSION`] → `Ok(())`, no-op and
    ///   idempotent (this also covers double-migrate after a successful
    ///   cycle); anything else → [`Error::InvariantViolated`] — this
    ///   executable can neither run nor migrate that layout (v1 has no
    ///   predecessor schema); future versions replace this arm with real
    ///   `version < N` transforms ending in `set_schema_version(e, N)`
    ///   (OZ eager pattern).
    pub fn migrate(e: &Env) -> Result<(), Error> {
        require_proxy_admin(e);

        if migration_pending(e) {
            // Self-check of the new executable's compiled-in economics
            // (compared as constants on purpose: an evil build carries
            // different values HERE, with no storage to spoof).
            if ROYALTY_BPS != 150 || PLATFORM_FEE_BPS != 150 {
                return Err(Error::InvariantViolated);
            }
            // TOV-151: full live-state vs InvariantSnapshot comparison —
            // pending and snapshot survive any failure so funds stay sealed
            // (early return, nothing below runs). Raw storage reads on
            // purpose (see the doc comment).
            let snapshot: InvariantSnapshot =
                e.storage().instance().get(&DataKey::InvariantSnapshot).unwrap();
            let artist_lockup_until: u64 =
                e.storage().instance().get(&DataKey::ArtistLockupUntil).unwrap();
            let treasury_lockup_until: u64 =
                e.storage().instance().get(&DataKey::TreasuryLockupUntil).unwrap();
            if Base::total_supply(e) != snapshot.total_supply
                || artist_lockup_until < snapshot.artist_lockup_until
                || treasury_lockup_until < snapshot.treasury_lockup_until
                || e.storage().instance().has(&DataKey::MintDone) != snapshot.minted
                || config_digest(e) != snapshot.config_digest
            {
                return Err(Error::InvariantViolated);
            }

            e.storage().instance().remove(&DataKey::MigrationPending);
            e.storage().instance().remove(&DataKey::InvariantSnapshot);
            upgradeable::set_schema_version(e, CURRENT_SCHEMA_VERSION);
            MigrationCompleted { schema: CURRENT_SCHEMA_VERSION }.publish(e);
            extend_instance_ttl(e);
            return Ok(());
        }

        if upgradeable::get_schema_version(e) == CURRENT_SCHEMA_VERSION {
            Ok(())
        } else {
            Err(Error::InvariantViolated)
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// The current upgrade/migration authority.
    pub fn proxy_admin(e: &Env) -> Address {
        proxy_admin(e)
    }

    /// Transfer the admin authority (e.g. single key → multi-sig). Admin-only.
    pub fn set_proxy_admin(e: &Env, new_admin: Address) {
        require_proxy_admin(e);
        e.storage().instance().set(&DataKey::ProxyAdmin, &new_admin);
        extend_instance_ttl(e);
    }

    /// Rotate the KYCAllowlist contract address (compliance-contract
    /// migration, TOV-140). Admin-only; emits `gating.updated("kyc", old,
    /// new)`. NOT a bypass: every subsequent movement consults the NEW
    /// address cross-contract — the replacement must itself be a live gating
    /// contract or all movements fail closed.
    pub fn set_kyc_allowlist(e: &Env, new: Address) {
        require_proxy_admin(e);
        let old: Address = e.storage().instance().get(&DataKey::KycAllowlist).unwrap();
        e.storage().instance().set(&DataKey::KycAllowlist, &new);
        GatingUpdated { kind: Symbol::new(e, "kyc"), old, new }.publish(e);
        extend_instance_ttl(e);
    }

    /// Rotate the EmergencyFreezeSet contract address (compliance-contract
    /// migration, TOV-140). Admin-only; emits `gating.updated("freeze", old,
    /// new)`. Same non-bypass semantics as [`Self::set_kyc_allowlist`].
    pub fn set_freeze_set(e: &Env, new: Address) {
        require_proxy_admin(e);
        let old: Address = e.storage().instance().get(&DataKey::FreezeSet).unwrap();
        e.storage().instance().set(&DataKey::FreezeSet, &new);
        GatingUpdated { kind: Symbol::new(e, "freeze"), old, new }.publish(e);
        extend_instance_ttl(e);
    }

    // ── Read-only economic constants (AE3: no write path exists) ────────────

    /// Artist royalty in basis points — compile-time constant (150 = 1.5%).
    pub fn royalty_bps(_e: &Env) -> u32 {
        ROYALTY_BPS
    }

    /// Platform fee in basis points — compile-time constant (150 = 1.5%).
    pub fn platform_fee_bps(_e: &Env) -> u32 {
        PLATFORM_FEE_BPS
    }

    // ── Write-once parameter getters ─────────────────────────────────────────

    /// Hash of the canonical Artwork ID this token fractionalizes.
    pub fn artwork_id(e: &Env) -> BytesN<32> {
        e.storage().instance().get(&DataKey::ArtworkId).unwrap()
    }

    /// Artist identity address.
    pub fn artist(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Artist).unwrap()
    }

    /// Artist payout (royalty destination) address.
    pub fn artist_payout(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::ArtistPayout).unwrap()
    }

    /// Treasury address.
    pub fn treasury(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    /// Planned artist retention (fractions, i128 — matches OZ amount type).
    pub fn artist_retention(e: &Env) -> i128 {
        e.storage().instance().get(&DataKey::ArtistRetention).unwrap()
    }

    /// Artist lockup expiry (unix seconds).
    pub fn artist_lockup_until(e: &Env) -> u64 {
        e.storage().instance().get(&DataKey::ArtistLockupUntil).unwrap()
    }

    /// Planned treasury retention (fractions, i128).
    pub fn treasury_retention(e: &Env) -> i128 {
        e.storage().instance().get(&DataKey::TreasuryRetention).unwrap()
    }

    /// Treasury lockup expiry (unix seconds).
    pub fn treasury_lockup_until(e: &Env) -> u64 {
        e.storage().instance().get(&DataKey::TreasuryLockupUntil).unwrap()
    }

    /// KYCAllowlist contract address (guard target, TOV-140).
    pub fn kyc_allowlist(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::KycAllowlist).unwrap()
    }

    /// EmergencyFreezeSet contract address (guard target, TOV-140).
    pub fn freeze_set(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::FreezeSet).unwrap()
    }

    /// MarketplaceSettler address (settle_trade gate, TOV-143).
    pub fn marketplace_settler(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::MarketplaceSettler).unwrap()
    }

    /// Offering escrow — the only address allowed to run `mint_settle`.
    pub fn minter(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Minter).unwrap()
    }

    /// USDC SAC address (settlement currency, TOV-143).
    pub fn usdc(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Usdc).unwrap()
    }

    /// Current implementation WASM hash (spec: "implementation address").
    pub fn impl_wasm_hash(e: &Env) -> BytesN<32> {
        e.storage().instance().get(&DataKey::ImplWasmHash).unwrap()
    }

    /// Absorbed under-subscription leftover counted into the artist lockup
    /// floor — 0 until `record_absorbed_leftover` has run (TOV-138/159).
    pub fn absorbed_leftover(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::ArtistAbsorbedLeftover)
            .unwrap_or(0)
    }

    /// Whether the one-shot initial distribution has been executed.
    pub fn is_minted(e: &Env) -> bool {
        e.storage().instance().has(&DataKey::MintDone)
    }

    /// The stored storage-schema version (1 after the constructor).
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// The invariant baseline recorded by `upgrade` — `Some` exactly while a
    /// migration is pending (ops visibility: what `migrate`/TOV-151 will
    /// judge recovery against), `None` once `migrate` has succeeded.
    pub fn invariant_snapshot(e: &Env) -> Option<InvariantSnapshot> {
        e.storage().instance().get(&DataKey::InvariantSnapshot)
    }
}

// ── SEP-41 surface via OZ (movement fns overridden through the guard funnel) ─
//
// `#[contractimpl(contracttrait)]` exports every trait default as a contract
// entrypoint; a method written here REPLACES the default. All four movement
// fns are overridden to route through `guard_movement` before delegating to
// the OZ `Base` implementation (the only balance-mutation path). Signatures
// match the traits exactly — note `MuxedAddress` on `transfer` — otherwise
// they would not override but silently add a second surface.

#[contractimpl(contracttrait)]
impl FungibleToken for FractionToken {
    type ContractType = Base;

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        guard_movement(e, Some(&from), Some(&to.address()), amount);
        Base::transfer(e, &from, &to, amount);
        extend_instance_ttl(e);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        guard_movement(e, Some(&from), Some(&to), amount);
        Base::transfer_from(e, &spender, &from, &to, amount);
        extend_instance_ttl(e);
    }
}

#[contractimpl(contracttrait)]
impl FungibleBurnable for FractionToken {
    fn burn(e: &Env, from: Address, amount: i128) {
        guard_movement(e, Some(&from), None, amount);
        Base::burn(e, &from, amount);
        extend_instance_ttl(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        guard_movement(e, Some(&from), None, amount);
        Base::burn_from(e, &spender, &from, amount);
        extend_instance_ttl(e);
    }
}
