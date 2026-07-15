use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted when a secondary RFQ trade is settled (`marketplace.trade_settled`).
/// `rfq_id` and `quote_id` ride in the topics so the indexer can filter a
/// specific quote without decoding event data; the trade parameters ride in the
/// data section.
#[contractevent(topics = ["marketplace", "trade_settled"])]
pub struct TradeSettled {
    #[topic]
    pub rfq_id: BytesN<32>,
    #[topic]
    pub quote_id: BytesN<32>,
    pub artwork_id: BytesN<32>,
    pub token: Address,
    pub buyer: Address,
    pub seller: Address,
    pub count: i128,
    pub gross_usdc: i128,
}
