#![no_std]
//! # OfferingEscrow (TOV-159, FR-05.04/06/10)
//!
//! One contract per primary offering. It escrows `price × count` USDC on each
//! bid, then — at `close_and_settle`, with the clearing price and winner
//! allocation computed OFF-CHAIN — atomically:
//!
//! 1. mints the whole `total_supply` FractionToken distribution (winners +
//!    artist/treasury retention + leftover→artist) via the token's one-shot
//!    `mint_settle`,
//! 2. refunds every bidder the difference `escrow − clearing_price × allocated`
//!    (losers get their escrow back in full — allocated 0),
//! 3. routes the `3%` platform fee to the treasury and the `97%` artist net to
//!    the artist payout.
//!
//! The contract is an EXECUTOR + INVARIANT VERIFIER, not an auction solver: it
//! enforces two conservation invariants on-chain — `Σ minted == total_supply`
//! ([`Error::InvalidAllocation`]) and `Σ refunds + fee + net == Σ escrowed`
//! ([`Error::UsdcAccounting`]) — so a malicious or wrong off-chain allocation
//! reverts the entire settlement (host atomicity).
//!
//! ## Circularity / the `bind_token` seam
//! The token is deployed with `minter = escrow.address`, but the escrow's
//! `Params.fraction_token` needs the token address — a deploy cycle. Solution
//! (pinned): the escrow constructor takes every parameter EXCEPT the token
//! (`fraction_token` starts `None`); the orchestrator then registers the token
//! with `minter = escrow.address` and calls `bind_token(token)` ONCE
//! (admin-gated) before the offering opens for settlement. A second bind
//! reverts [`Error::TokenAlreadyBound`].
//!
//! ## Auth model
//! `submit_bid` / `cancel_bid` require the bidder's auth (their USDC moves in
//! and out). `bind_token` / `close_offering` / `close_and_settle` /
//! `cancel_offering` require the admin's auth (a single key now, a multi-sig
//! account later — `require_auth` is agnostic).

mod contract;
mod error;
mod events;
mod storage;

pub use contract::{OfferingEscrow, OfferingEscrowClient};
pub use error::Error;
pub use storage::{Bid, Params, Status};

#[cfg(test)]
mod test;
