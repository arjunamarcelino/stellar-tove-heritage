use soroban_sdk::contracterror;

/// Contract errors with explicit, permanently stable discriminants (append-only:
/// existing codes are never renumbered or reused).
///
/// The surface is deliberately tiny: every other failure is either a host Auth
/// error (a mis-signed buyer/seller intent, or a non-admin `upgrade`/`set_admin`)
/// or is delegated to `FractionToken.settle_trade` (`count`/`gross`/
/// `buyer == seller` → its `InvalidTrade`; frozen/kyc/lockup → its typed errors).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `accept_quote` ran for a `(rfq_id, quote_id)` that is already settled —
    /// the settlement is one-shot, even with fresh valid signatures.
    QuoteAlreadySettled = 1,
    /// The `artwork_id` has no deployed token in the factory registry
    /// (`token_of` returned `None`) — no canonical token to settle against.
    TokenNotFound = 2,
}
