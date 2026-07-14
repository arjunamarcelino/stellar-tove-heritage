use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, vec, Address, BytesN, Env, IntoVal, Map,
    Symbol, Val, Vec,
};

use crate::error::Error;
use crate::events::{
    BidCancelled, BidSubmitted, OfferingCancelled, OfferingClosed, OfferingSettled, TokenBound,
};
use crate::storage::{
    extend_bid_ttl, extend_idem_ttl, extend_instance_ttl, Bid, DataKey, Params, Status,
};

/// Primary-offering platform fee, in basis points (3% — DISTINCT from the
/// secondary 1.5%/1.5% split in the token's `settle_trade`). Compile-time
/// constant: no storage slot, no setter — it can only change with a new
/// canonical WASM (TOV-146), never per deployment.
pub const PLATFORM_FEE_BPS: u32 = 300;

#[contract]
pub struct OfferingEscrow;

#[contractimpl]
impl OfferingEscrow {
    /// Bind the offering parameters and open bidding. Runs once at deploy.
    ///
    /// Takes every [`Params`] field EXCEPT `fraction_token` — the token does
    /// not exist yet (it is deployed with `minter = this escrow's address`),
    /// so `fraction_token` starts `None` and is set once by [`bind_token`].
    /// Status starts `Open`.
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: &Env,
        usdc: Address,
        total_supply: i128,
        artist: Address,
        artist_retention: i128,
        treasury: Address,
        treasury_retention: i128,
        leftover_to_artist: i128,
        artist_payout: Address,
        admin: Address,
    ) {
        // Validate the economic parameters at the source. The settle-time mint
        // invariant is `Σ allocated + artist_retention + treasury_retention +
        // leftover_to_artist == total_supply`; a NEGATIVE retention/leftover
        // would satisfy that sum while the mint loop (which only pushes
        // recipients with amount > 0) skips the negative leg, over-minting. A
        // non-positive supply or retentions exceeding supply describe an
        // offering that could never settle validly.
        if total_supply <= 0
            || artist_retention < 0
            || treasury_retention < 0
            || leftover_to_artist < 0
            || artist_retention + treasury_retention + leftover_to_artist > total_supply
        {
            panic_with_error!(env, Error::InvalidParams);
        }

        let params = Params {
            fraction_token: None,
            usdc,
            total_supply,
            artist,
            artist_retention,
            treasury,
            treasury_retention,
            leftover_to_artist,
            artist_payout,
            admin,
        };
        let storage = env.storage().instance();
        storage.set(&DataKey::Params, &params);
        storage.set(&DataKey::Status, &Status::Open);
        storage.set(&DataKey::BidSeq, &0u32);
        storage.set(&DataKey::EscrowTotal, &0i128);
        extend_instance_ttl(env);
    }

    /// Bind the FractionToken address exactly once (admin-gated). The token is
    /// constructed with `minter = this escrow's address`; this seam closes the
    /// deploy cycle (see crate docs). A second call reverts
    /// [`Error::TokenAlreadyBound`].
    pub fn bind_token(env: &Env, token: Address) -> Result<(), Error> {
        let mut params = load_params(env);
        params.admin.require_auth();
        if params.fraction_token.is_some() {
            return Err(Error::TokenAlreadyBound);
        }
        params.fraction_token = Some(token.clone());
        env.storage().instance().set(&DataKey::Params, &params);
        extend_instance_ttl(env);
        TokenBound { token }.publish(env);
        Ok(())
    }

    // ── Bidding (Open) ────────────────────────────────────────────────────────

    /// Submit a bid: escrow `price * count` USDC (transfer bidder → escrow) and
    /// record it. Requires the bidder's auth; only while `Open`. `price > 0 &&
    /// count > 0` else [`Error::InvalidBid`]; a repeated `idempotency_key`
    /// reverts [`Error::DuplicateBid`] (backend retry guard). Returns the new
    /// 1-based bid id.
    pub fn submit_bid(
        env: &Env,
        bidder: Address,
        price: i128,
        count: i128,
        idempotency_key: BytesN<32>,
    ) -> Result<u32, Error> {
        bidder.require_auth();
        require_open(env)?;
        if price <= 0 || count <= 0 {
            return Err(Error::InvalidBid);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Idem(idempotency_key.clone()))
        {
            return Err(Error::DuplicateBid);
        }

        let escrow = price * count;
        let params = load_params(env);

        // Effects before interaction (CEI): record the bid + idempotency key and
        // bump the running total BEFORE pulling the escrow, so a reentrant
        // submit_bid with the same key (only reachable via a non-standard USDC
        // that hooks `transfer`) hits the DuplicateBid guard. A failed transfer
        // reverts the whole tx atomically, rolling the record back.
        let id = next_bid_id(env);
        let bid = Bid { bidder: bidder.clone(), price, count, escrow, active: true };
        env.storage().persistent().set(&DataKey::Bid(id), &bid);
        env.storage()
            .persistent()
            .set(&DataKey::Idem(idempotency_key.clone()), &id);
        add_escrow_total(env, escrow);

        token::TokenClient::new(env, &params.usdc).transfer(
            &bidder,
            &env.current_contract_address(),
            &escrow,
        );

        extend_bid_ttl(env, id);
        extend_idem_ttl(env, &idempotency_key);
        extend_instance_ttl(env);
        BidSubmitted { bidder, bid_id: id, price, count, escrow }.publish(env);
        Ok(id)
    }

    /// Cancel an active bid and refund its full escrow (transfer escrow →
    /// bidder). Only the bid's own `bidder` may cancel, only while `Open`.
    /// `caller` is the claimed bidder and must authorize; `caller != bid.bidder`
    /// reverts [`Error::NotBidOwner`]; an already-inactive bid reverts
    /// [`Error::BidInactive`].
    pub fn cancel_bid(env: &Env, caller: Address, bid_id: u32) -> Result<(), Error> {
        caller.require_auth();
        require_open(env)?;
        let mut bid = load_bid(env, bid_id)?;
        if bid.bidder != caller {
            return Err(Error::NotBidOwner);
        }
        if !bid.active {
            return Err(Error::BidInactive);
        }

        let params = load_params(env);

        // Effects before interaction (CEI): mark the bid inactive and drop the
        // running total BEFORE refunding, so a reentrant cancel_bid on the same
        // id (only reachable via a non-standard USDC that hooks `transfer`) hits
        // the BidInactive guard instead of double-refunding.
        let refund = bid.escrow;
        bid.active = false;
        env.storage().persistent().set(&DataKey::Bid(bid_id), &bid);
        add_escrow_total(env, -refund);

        token::TokenClient::new(env, &params.usdc).transfer(
            &env.current_contract_address(),
            &bid.bidder,
            &refund,
        );

        extend_bid_ttl(env, bid_id);
        extend_instance_ttl(env);
        BidCancelled { bidder: bid.bidder, bid_id, refund }.publish(env);
        Ok(())
    }

    // ── Admin lifecycle ───────────────────────────────────────────────────────

    /// Close bidding: `Open → Closed` (admin). No new bids after this; settle
    /// is next. Reverts [`Error::OfferingNotOpen`] if not `Open`.
    pub fn close_offering(env: &Env) -> Result<(), Error> {
        let params = load_params(env);
        params.admin.require_auth();
        require_open(env)?;
        env.storage().instance().set(&DataKey::Status, &Status::Closed);
        extend_instance_ttl(env);
        OfferingClosed {}.publish(env);
        Ok(())
    }

    /// Abort the offering (admin): `→ Cancelled`. Pre-bid only — reverts
    /// [`Error::HasBids`] if any bid is still active, and
    /// [`Error::AlreadySettled`] once settled. (Mid-offering
    /// cancel-with-refunds is out of scope; refund each bid via `cancel_bid`
    /// first.)
    pub fn cancel_offering(env: &Env) -> Result<(), Error> {
        let params = load_params(env);
        params.admin.require_auth();
        if load_status(env) == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if escrowed_total_of(env) > 0 {
            return Err(Error::HasBids);
        }
        env.storage().instance().set(&DataKey::Status, &Status::Cancelled);
        extend_instance_ttl(env);
        OfferingCancelled {}.publish(env);
        Ok(())
    }

    // ── Atomic settlement (Closed → Settled) ──────────────────────────────────

    /// Settle the offering atomically against an OFF-CHAIN uniform-price
    /// clearing: `clearing_price` and `allocations = [(bid_id, allocated)]`
    /// (winners only; losers omitted → refunded in full). Admin-gated, only
    /// while `Closed`. The contract VERIFIES two conservation invariants; any
    /// sub-step failure reverts the whole transaction (host atomicity).
    ///
    /// PINNED order (binding):
    /// 1. Validate: for each `(bid_id, allocated)` the bid must exist & be
    ///    active, `0 <= allocated <= bid.count`, no duplicate bid_id, and
    ///    `refund = escrow − clearing_price*allocated >= 0` (a negative refund
    ///    means `clearing_price > price`) — else [`Error::InvalidAllocation`].
    ///    Then the mint invariant `Σ allocated + artist_retention +
    ///    treasury_retention + leftover_to_artist == total_supply` — else
    ///    [`Error::InvalidAllocation`]. `proceeds = Σ paid`.
    /// 2. Build recipients: each winner (`allocated > 0`) → `allocated`;
    ///    `(artist, artist_retention + leftover_to_artist)` if `> 0`;
    ///    `(treasury, treasury_retention)` if `> 0`. Call the token's one-shot
    ///    `mint_settle(self, recipients)`.
    /// 3. Refund EVERY active bid (winners' partial, losers' full):
    ///    `refund > 0 → usdc.transfer(self → bidder, refund)`; mark inactive.
    /// 4. `platform_fee = proceeds * 300 / 10000` (floor) → treasury;
    ///    `artist_net = proceeds − platform_fee` → artist_payout (skip zero
    ///    legs).
    /// 5. Belt: `Σ refunds + platform_fee + artist_net == Σ escrowed` else
    ///    [`Error::UsdcAccounting`].
    /// 6. `Status = Settled`; emit `offering.settled`.
    pub fn close_and_settle(
        env: &Env,
        clearing_price: i128,
        allocations: Vec<(u32, i128)>,
    ) -> Result<(), Error> {
        let params = load_params(env);
        params.admin.require_auth();

        // State gate: Settled outranks the not-Closed check (a settled offering
        // reports the more specific error).
        match load_status(env) {
            Status::Settled => return Err(Error::AlreadySettled),
            Status::Closed => {}
            _ => return Err(Error::NotClosed),
        }
        let token_addr = params
            .fraction_token
            .clone()
            .ok_or(Error::TokenNotBound)?;

        // ── 1. Validate allocations + mint invariant ──────────────────────────
        let mut alloc: Map<u32, i128> = Map::new(env);
        let mut sum_allocated: i128 = 0;
        let mut proceeds: i128 = 0;
        for (bid_id, allocated) in allocations.iter() {
            let bid = match env.storage().persistent().get::<_, Bid>(&DataKey::Bid(bid_id)) {
                Some(b) => b,
                None => return Err(Error::InvalidAllocation),
            };
            if !bid.active {
                return Err(Error::InvalidAllocation);
            }
            if allocated < 0 || allocated > bid.count {
                return Err(Error::InvalidAllocation);
            }
            if alloc.contains_key(bid_id) {
                return Err(Error::InvalidAllocation);
            }
            // Uniform-price fairness: every WINNER must have bid at least the
            // clearing price, and the clearing price must be positive. The
            // `refund >= 0` guard below is NOT sufficient on its own — for a
            // partially-allocated winner (`allocated < count`) it permits a
            // clearing price far above the bidder's per-unit `price`, silently
            // overcharging them, and `clearing_price == 0` would mint the whole
            // supply for free. Losers (`allocated == 0`) pay nothing, so the
            // constraint only applies to winners.
            if allocated > 0 && (clearing_price <= 0 || clearing_price > bid.price) {
                return Err(Error::InvalidAllocation);
            }
            let paid = clearing_price * allocated;
            let refund = bid.escrow - paid;
            if refund < 0 {
                return Err(Error::InvalidAllocation);
            }
            alloc.set(bid_id, allocated);
            sum_allocated += allocated;
            proceeds += paid;
        }
        if sum_allocated
            + params.artist_retention
            + params.treasury_retention
            + params.leftover_to_artist
            != params.total_supply
        {
            return Err(Error::InvalidAllocation);
        }

        // ── 2. Build mint recipients + one-shot mint_settle ───────────────────
        let mut recipients: Vec<(Address, i128)> = Vec::new(env);
        for (bid_id, allocated) in allocations.iter() {
            if allocated > 0 {
                let bid: Bid = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Bid(bid_id))
                    .unwrap();
                recipients.push_back((bid.bidder, allocated));
            }
        }
        let artist_amount = params.artist_retention + params.leftover_to_artist;
        if artist_amount > 0 {
            recipients.push_back((params.artist.clone(), artist_amount));
        }
        if params.treasury_retention > 0 {
            recipients.push_back((params.treasury.clone(), params.treasury_retention));
        }
        let self_addr = env.current_contract_address();

        // Checks-effects-interactions: flip to Settled BEFORE any external call
        // (mint_settle, and the USDC transfers below). A malicious bound token
        // reentering close_and_settle during mint_settle then hits the
        // `Status::Settled => AlreadySettled` gate instead of double-settling.
        // Any later failure reverts the whole atomic tx, including this flip.
        env.storage().instance().set(&DataKey::Status, &Status::Settled);
        env.storage().instance().set(&DataKey::EscrowTotal, &0i128);

        let mint_args: Vec<Val> = vec![
            env,
            self_addr.into_val(env),
            recipients.into_val(env),
        ];
        env.invoke_contract::<()>(&token_addr, &Symbol::new(env, "mint_settle"), mint_args);

        // ── 3. Refund EVERY active bid (allocated defaults to 0 for losers) ───
        let usdc = token::TokenClient::new(env, &params.usdc);
        // Snapshot the real USDC held before any outflow — the conservation belt
        // below asserts the ACTUAL amount that left equals `sum_escrow`.
        let balance_before = usdc.balance(&self_addr);
        let seq = bid_count_of(env);
        let mut sum_refund: i128 = 0;
        let mut sum_escrow: i128 = 0;
        for id in 1..=seq {
            let mut bid = match env.storage().persistent().get::<_, Bid>(&DataKey::Bid(id)) {
                Some(b) => b,
                // Every id in 1..=seq was created by `submit_bid` and is never
                // removed (`cancel_bid` only flips `active`), so a missing entry
                // means it was lost/archived. Refuse to settle rather than
                // silently skip a possibly-funded bid — skipping would strand
                // that bidder's escrowed USDC permanently (status becomes
                // Settled with no refund path). The whole settle reverts
                // atomically; the operator restores the entry and retries.
                None => return Err(Error::BidNotFound),
            };
            if !bid.active {
                continue;
            }
            let allocated = alloc.get(id).unwrap_or(0);
            let refund = bid.escrow - clearing_price * allocated;
            if refund > 0 {
                usdc.transfer(&self_addr, &bid.bidder, &refund);
            }
            sum_refund += refund;
            sum_escrow += bid.escrow;
            bid.active = false;
            env.storage().persistent().set(&DataKey::Bid(id), &bid);
            extend_bid_ttl(env, id);
        }

        // ── 4. Primary split 3% / 97% ─────────────────────────────────────────
        let platform_fee = proceeds * (PLATFORM_FEE_BPS as i128) / 10_000;
        let artist_net = proceeds - platform_fee;
        if platform_fee > 0 {
            usdc.transfer(&self_addr, &params.treasury, &platform_fee);
        }
        if artist_net > 0 {
            usdc.transfer(&self_addr, &params.artist_payout, &artist_net);
        }

        // ── 5. USDC conservation belt ─────────────────────────────────────────
        // Two checks: (1) the arithmetic identity `sum_refund + platform_fee +
        // artist_net == sum_escrow` — holds by construction, kept as a cheap
        // guard against a future refactor breaking the split; (2) the REAL
        // balance delta — exactly `sum_escrow` must have left the contract via
        // the actual USDC token, which catches a non-1:1 / fake USDC or any
        // transfer that moved a different amount than the math expects (the old
        // belt was (1) alone, an unfalsifiable tautology).
        if sum_refund + platform_fee + artist_net != sum_escrow
            || balance_before - usdc.balance(&self_addr) != sum_escrow
        {
            return Err(Error::UsdcAccounting);
        }

        // ── 6. Finalize (Status/EscrowTotal already set pre-interaction) ──────
        extend_instance_ttl(env);
        OfferingSettled { clearing_price, proceeds, platform_fee, artist_net }.publish(env);
        Ok(())
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    /// Current lifecycle status.
    pub fn status(env: &Env) -> Status {
        load_status(env)
    }

    /// The bid at `bid_id`, or `None`.
    pub fn bid(env: &Env, bid_id: u32) -> Option<Bid> {
        env.storage().persistent().get(&DataKey::Bid(bid_id))
    }

    /// The offering parameters.
    pub fn params(env: &Env) -> Params {
        load_params(env)
    }

    /// Number of bids ever submitted (the id high-water mark; ids are 1-based).
    pub fn bid_count(env: &Env) -> u32 {
        bid_count_of(env)
    }

    /// Sum of escrow currently held for ACTIVE bids (O(1), stored).
    pub fn escrowed_total(env: &Env) -> i128 {
        escrowed_total_of(env)
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn load_params(env: &Env) -> Params {
    env.storage().instance().get(&DataKey::Params).unwrap()
}

fn load_status(env: &Env) -> Status {
    env.storage().instance().get(&DataKey::Status).unwrap()
}

fn require_open(env: &Env) -> Result<(), Error> {
    if load_status(env) != Status::Open {
        return Err(Error::OfferingNotOpen);
    }
    Ok(())
}

fn load_bid(env: &Env, bid_id: u32) -> Result<Bid, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Bid(bid_id))
        .ok_or(Error::BidNotFound)
}

fn bid_count_of(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::BidSeq).unwrap_or(0)
}

fn next_bid_id(env: &Env) -> u32 {
    let id = bid_count_of(env) + 1;
    env.storage().instance().set(&DataKey::BidSeq, &id);
    id
}

fn escrowed_total_of(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::EscrowTotal).unwrap_or(0)
}

fn add_escrow_total(env: &Env, delta: i128) {
    let total = escrowed_total_of(env) + delta;
    env.storage().instance().set(&DataKey::EscrowTotal, &total);
}
