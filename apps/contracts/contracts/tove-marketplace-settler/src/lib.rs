#![no_std]
//! # MarketplaceSettler (TOV-179, FR-06.05)
//!
//! Singleton Soroban contract that settles one secondary-market RFQ trade per
//! call. `accept_quote` requires BOTH the buyer and the seller to natively
//! authorize the exact trade tuple `(rfq_id, quote_id, artwork_id, count,
//! gross_usdc)`, resolves the canonical FractionToken from `artwork_id` through
//! the fraction-factory, records the quote as settled (one-shot), then
//! atomically invokes `token.settle_trade(buyer, seller, count, gross_usdc)`.
//!
//! ## Trust model
//! The settler is the executor + consent-verifier, not the RFQ lifecycle owner.
//! It holds no funds and no economic constants. `settle_trade` moves the
//! seller's fractions through the token's internal OZ path with NO seller auth
//! of its own — so the seller's `require_auth_for_args` here is the ONLY thing
//! protecting those fractions from being taken at the wrong count/price. Both
//! parties therefore bind the full economic tuple. The token's compliance
//! funnel (frozen/kyc/lockup) and the 2%/5% split are inherited, not
//! re-implemented.
//!
//! ## Auth
//! `accept_quote` is permissionless to call — security is entirely in the two
//! required auths, not in who submits the transaction. `upgrade` and
//! `set_admin` are admin-gated (multi-sig account). A mis-signed intent
//! surfaces as a host Auth error, not a custom typed error.

mod contract;
mod error;
mod events;
mod storage;

pub use contract::{MarketplaceSettler, MarketplaceSettlerClient};
pub use error::Error;

#[cfg(test)]
mod test;
