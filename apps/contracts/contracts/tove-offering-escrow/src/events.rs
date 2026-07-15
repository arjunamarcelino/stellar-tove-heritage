use soroban_sdk::{contractevent, Address};

/// Emitted when the FractionToken is bound (`token.bound`). One-shot.
#[contractevent(topics = ["token", "bound"])]
pub struct TokenBound {
    #[topic]
    pub token: Address,
}

/// Emitted on a successful `submit_bid` (`bid.submitted`). The 4-topic cap
/// spends its two free slots on `bidder` and `bid_id` (indexers filter per
/// bidder / bid without decoding data); the economics ride in the data map.
#[contractevent(topics = ["bid", "submitted"])]
pub struct BidSubmitted {
    #[topic]
    pub bidder: Address,
    #[topic]
    pub bid_id: u32,
    pub price: i128,
    pub count: i128,
    pub escrow: i128,
}

/// Emitted on `cancel_bid` (`bid.cancelled`) with the refunded escrow.
#[contractevent(topics = ["bid", "cancelled"])]
pub struct BidCancelled {
    #[topic]
    pub bidder: Address,
    #[topic]
    pub bid_id: u32,
    pub refund: i128,
}

/// Emitted on `close_offering` (`offering.closed`).
#[contractevent(topics = ["offering", "closed"])]
pub struct OfferingClosed {}

/// Emitted on `cancel_offering` (`offering.cancelled`).
#[contractevent(topics = ["offering", "cancelled"])]
pub struct OfferingCancelled {}

/// Emitted on a successful `close_and_settle` (`offering.settled`). The static
/// two-symbol prefix is enough for indexers; the settlement economics (the
/// clearing price and the split) ride in the data map, pinned so off-chain
/// accounting reconciles without recomputing the BPS math.
#[contractevent(topics = ["offering", "settled"])]
pub struct OfferingSettled {
    pub clearing_price: i128,
    pub proceeds: i128,
    pub platform_fee: i128,
    pub artist_net: i128,
}
