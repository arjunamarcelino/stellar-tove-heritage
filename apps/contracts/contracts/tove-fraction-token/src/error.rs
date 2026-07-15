use soroban_sdk::contracterror;

/// Contract errors with explicit, permanently stable discriminants.
///
/// ABI stability rule (binding across upgrades): downstream tickets append
/// new variants with fresh codes; existing codes are NEVER renumbered or
/// reused. OZ `FungibleTokenError` occupies 100+ in its own type, so our
/// small codes stay unambiguous in logs even across error types.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A schema/invariant gate failed: the stored schema version is not one
    /// this executable can run or migrate (see `migrate` for the pinned
    /// semantics). Full invariant checks arrive with TOV-151.
    InvariantViolated = 1,
    /// `mint_settle` was already executed once for this artwork; the initial
    /// distribution is one-shot and can never be repeated.
    AlreadyMinted = 2,
    /// `mint_settle` was invoked by an authorized operator that is not the
    /// configured `minter` (offering escrow).
    UnauthorizedMinter = 3,
    /// `mint_settle` was invoked with an empty recipients vector. Rejected so
    /// the one-shot flag can never be burned on a zero-supply distribution
    /// (recoverable only via WASM upgrade otherwise).
    EmptyMint = 4,
    /// A transfer destination is not on the KYC allowlist (`is_allowed(to)`
    /// returned false on the stored `KycAllowlist` contract). TOV-140.
    RecipientNotWhitelisted = 5,
    /// A movement party is in the emergency freeze set (`is_frozen` returned
    /// true on the stored `FreezeSet` contract). Pinned precedence: freeze is
    /// reported ahead of the KYC check — frozen(from) → frozen(to) → kyc(to).
    /// TOV-140.
    Frozen = 6,
    /// An outflow from the artist during the active artist lockup
    /// (`now < artist_lockup_until`) would drop the artist balance below the
    /// locked floor (`artist_retention + absorbed_leftover`). Checked LAST in
    /// the pinned guard order: frozen(from) → frozen(to) → kyc(to) →
    /// lockup(from). TOV-138.
    ArtistLockupViolated = 7,
    /// An outflow from the treasury during the active treasury lockup
    /// (`now < treasury_lockup_until`) would drop the treasury balance below
    /// the locked floor (`treasury_retention`). Same pinned guard position as
    /// the artist arm: frozen(from) → frozen(to) → kyc(to) → lockup(from).
    /// TOV-139.
    TreasuryLockupViolated = 8,
    /// `record_absorbed_leftover` was called a second time — the absorbed
    /// leftover slot is one-shot (minter-only, pre-mint). TOV-138.
    LeftoverAlreadyRecorded = 9,
    /// `settle_trade` was invoked with invalid trade parameters: `count <= 0`,
    /// `gross_usdc < 0`, or `buyer == seller`. Gross 0 is VALID (a fraction
    /// gift/comp trade — still fully compliance-gated); a self-trade never is.
    /// TOV-143.
    InvalidTrade = 10,
    /// A migration is pending: `upgrade` has run but `migrate` has not yet
    /// verified the new executable. EVERY balance movement (transfer,
    /// transfer_from, burn, burn_from, mint_settle, settle_trade) and
    /// `record_absorbed_leftover` is sealed with this error until `migrate()`
    /// succeeds — the new executable can never move a fraction before it
    /// passes the invariant gate. Admin ops (upgrade/migrate/set_proxy_admin/
    /// getters) stay live: they ARE the recovery path. TOV-150.
    MigrationPending = 11,
    /// A non-positive amount was supplied where a strictly-positive one is
    /// required: a `mint_settle` recipient with `amount <= 0` (zero is a wasted
    /// leg; negative is caught by OZ too but this gives a typed error), or a
    /// negative `record_absorbed_leftover` (which would drop the artist lockup
    /// floor below `artist_retention`).
    InvalidAmount = 12,
}
