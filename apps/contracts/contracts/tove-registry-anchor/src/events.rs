use soroban_sdk::{contractevent, BytesN};

/// Emitted when a daily Merkle root is anchored (`registry.anchored`).
/// `merkle_root` and `batch_date` ride in the topics so the indexer can
/// filter without decoding event data.
#[contractevent(topics = ["registry", "anchored"])]
pub struct RegistryAnchored {
    #[topic]
    pub merkle_root: BytesN<32>,
    #[topic]
    pub batch_date: u32,
}
