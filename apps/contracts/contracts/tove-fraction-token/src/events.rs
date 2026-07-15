use soroban_sdk::{contractevent, Address, BytesN, Symbol};

/// Emitted when the executable is swapped (`proxy.upgraded`). Carries the old
/// and new implementation WASM hashes in the topics — mirroring the
/// registry-anchor event style — so indexers can filter without decoding
/// event data. This is the spec's `Upgraded(old_impl, new_impl)` mapped to
/// Soroban (implementation address → WASM hash).
#[contractevent(topics = ["proxy", "upgraded"])]
pub struct ProxyUpgraded {
    #[topic]
    pub old_wasm_hash: BytesN<32>,
    #[topic]
    pub new_wasm_hash: BytesN<32>,
}

/// Emitted when a gating contract address is rotated (`gating.updated`) —
/// one event type for both setters, discriminated by `kind`
/// (`Symbol("kyc")` for `set_kyc_allowlist`, `Symbol("freeze")` for
/// `set_freeze_set`). `kind` rides in the topics (registry-anchor style) so
/// indexers can filter per gating contract without decoding data; `old` and
/// `new` travel in the data map because Soroban caps events at 4 topics —
/// the two-symbol prefix plus `kind` leaves only one slot, not the two the
/// address pair needs. TOV-140.
#[contractevent(topics = ["gating", "updated"])]
pub struct GatingUpdated {
    #[topic]
    pub kind: Symbol,
    pub old: Address,
    pub new: Address,
}

/// Emitted when a pending migration completes (`migration.completed`) — the
/// invariant gate passed, the pending seal is lifted, and movement is live
/// again on the verified executable. Complements `proxy.upgraded` (R6): the
/// upgrade event marks the swap, this event marks the moment funds can move.
/// `schema` (the stamped storage-schema version) rides in the data map — the
/// static two-symbol topic prefix is enough for indexers to find it, and the
/// version is payload, not a filter key. TOV-150.
#[contractevent(topics = ["migration", "completed"])]
pub struct MigrationCompleted {
    pub schema: u32,
}

/// Emitted on a successful `settle_trade` (`trade.settled`). Soroban caps
/// events at 4 topics, so the static two-symbol prefix leaves exactly two
/// slots — buyer and seller ride in the topics (indexers filter per party
/// without decoding data); `count`, `gross_usdc`, and all three split legs
/// travel in the data map. The SEP-41 `transfer` event for the fraction move
/// is emitted separately (via `emit_transfer`) — this event carries the
/// ECONOMICS of the trade, pinned so off-chain accounting can reconcile the
/// exact split without recomputing BPS math. TOV-143.
#[contractevent(topics = ["trade", "settled"])]
pub struct TradeSettled {
    #[topic]
    pub buyer: Address,
    #[topic]
    pub seller: Address,
    pub count: i128,
    pub gross_usdc: i128,
    pub platform_cut: i128,
    pub artist_cut: i128,
    pub seller_net: i128,
}
