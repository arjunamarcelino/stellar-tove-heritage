use soroban_sdk::{contracttype, Address, BytesN, Env};

const DAY_IN_LEDGERS: u32 = 17280; // ~5s ledgers
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Write-once (except `fraction_token`) per-offering parameters.
///
/// `fraction_token` is `Option<Address>`: the escrow is deployed BEFORE the
/// token (the token's `minter` must be this escrow's address), so the slot
/// starts `None` and is filled exactly once by `bind_token`. See the crate
/// docs for the circularity rationale.
///
/// `total_supply`, both retentions, and `leftover_to_artist` are the mint
/// invariant inputs: at settle `Σ allocated + artist_retention +
/// treasury_retention + leftover_to_artist == total_supply`. `treasury` is
/// also the primary-fee recipient (3%); `artist_payout` receives the 97% net.
#[contracttype]
#[derive(Clone)]
pub struct Params {
    /// FractionToken address — `None` until `bind_token` (see crate docs).
    pub fraction_token: Option<Address>,
    /// USDC SAC address — the money leg of every escrow / refund / split.
    pub usdc: Address,
    /// Total fractions minted at settlement (the mint-invariant target).
    pub total_supply: i128,
    /// Artist identity — receives `artist_retention + leftover_to_artist`.
    pub artist: Address,
    /// Fractions retained by the artist (minted to `artist`).
    pub artist_retention: i128,
    /// Treasury identity — receives `treasury_retention` fractions AND the 3%
    /// primary platform fee (USDC).
    pub treasury: Address,
    /// Fractions retained by the treasury (minted to `treasury`).
    pub treasury_retention: i128,
    /// Under-subscription leftover folded into the artist mint (FR-04.06).
    pub leftover_to_artist: i128,
    /// Artist payout address — receives the 97% USDC net.
    pub artist_payout: Address,
    /// Admin authority (bind/close/settle/cancel; multi-sig account later).
    pub admin: Address,
}

/// Strict lifecycle: `Open → Closed → Settled`, or `Open → Cancelled`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    /// Accepting bids (submit / cancel live).
    Open,
    /// Bidding closed; awaiting `close_and_settle`.
    Closed,
    /// Distribution minted, refunds + split paid — terminal.
    Settled,
    /// Offering aborted before any active bid — terminal.
    Cancelled,
}

/// One recorded bid. `escrow = price * count` USDC is held by the contract
/// while `active`; `cancel_bid` (Open) and `close_and_settle` (refund leg)
/// both clear `active` after returning the appropriate USDC.
#[contracttype]
#[derive(Clone)]
pub struct Bid {
    pub bidder: Address,
    pub price: i128,
    pub count: i128,
    pub escrow: i128,
    pub active: bool,
}

/// Storage keys. `#[contracttype]` enum keys serialize by VARIANT NAME, but
/// this is a fresh contract with no OZ base sharing the namespace, so any name
/// is collision-free.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// [`Params`] (instance).
    Params,
    /// [`Status`] (instance).
    Status,
    /// Monotonic `u32` bid-id counter (instance); ids are 1-based.
    BidSeq,
    /// Running sum of ACTIVE escrow, `i128` (instance) — O(1)
    /// `escrowed_total()` and the "no active bids" gate for `cancel_offering`.
    EscrowTotal,
    /// [`Bid`] by id (persistent).
    Bid(u32),
    /// Idempotency key → bid id `u32` (persistent). A repeated key reverts
    /// [`crate::Error::DuplicateBid`].
    Idem(BytesN<32>),
}

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn extend_bid_ttl(env: &Env, bid_id: u32) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Bid(bid_id), BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn extend_idem_ttl(env: &Env, key: &BytesN<32>) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Idem(key.clone()), BUMP_THRESHOLD, BUMP_AMOUNT);
}
