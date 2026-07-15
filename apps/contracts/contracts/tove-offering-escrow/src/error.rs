use soroban_sdk::contracterror;

/// Contract errors with explicit, permanently stable discriminants.
///
/// ABI stability rule (binding): downstream work appends new variants with
/// fresh codes; existing codes are NEVER renumbered or reused. Codes 1..=11
/// are the plan-pinned set; 12..=13 are appended (`bind_token` guards).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A bid op (`submit_bid` / `cancel_bid`) or `close_offering` ran while the
    /// offering was not `Open`.
    OfferingNotOpen = 1,
    /// `submit_bid` reused an idempotency key already bound to a bid.
    DuplicateBid = 2,
    /// `submit_bid` with `price <= 0` or `count <= 0`.
    InvalidBid = 3,
    /// A referenced bid id has no stored bid.
    BidNotFound = 4,
    /// `cancel_bid` caller is not the bid's `bidder`.
    NotBidOwner = 5,
    /// The referenced bid is not `active` (already cancelled or settled).
    BidInactive = 6,
    /// `close_and_settle` ran while the offering was not `Closed`.
    NotClosed = 7,
    /// The off-chain allocation violates an on-chain rule: a bad `(bid_id,
    /// allocated)` (unknown/inactive bid, `allocated < 0`, `allocated > count`,
    /// duplicate bid_id, or `refund < 0` i.e. `clearing_price > price`), or the
    /// mint invariant `Σ allocated + retentions + leftover != total_supply`.
    InvalidAllocation = 8,
    /// The USDC conservation belt failed: `Σ refunds + platform_fee +
    /// artist_net != Σ escrowed`. Must always pass by construction — a trip
    /// means a math/state bug, and the whole settlement reverts.
    UsdcAccounting = 9,
    /// `close_and_settle` ran on an already-`Settled` offering (also caught by
    /// the token's one-shot `mint_settle`, this is the earlier typed guard).
    AlreadySettled = 10,
    /// `cancel_offering` ran while at least one bid was still active — cancel is
    /// a pre-bid abort only; mid-offering cancel-with-refunds is out of scope.
    HasBids = 11,
    /// `bind_token` was called a second time — the token binding is one-shot.
    TokenAlreadyBound = 12,
    /// `close_and_settle` ran before `bind_token` — no token to `mint_settle`.
    TokenNotBound = 13,
    /// `__constructor` was given economically impossible parameters:
    /// `total_supply <= 0`, a negative retention/leftover, or retentions whose
    /// sum exceeds `total_supply` (no valid allocation could ever settle).
    /// Guards the mint invariant at the source — a negative retention would
    /// otherwise satisfy `Σ == total_supply` while the mint loop skips it,
    /// over-minting.
    InvalidParams = 14,
}
