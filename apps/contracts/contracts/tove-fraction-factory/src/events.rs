use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted when a FractionToken is born (`factory.deployed`). `artwork_id`
/// and the token address ride in the topics so the indexer can filter without
/// decoding event data (registry-anchor event style); the canonical WASM hash
/// actually used for the deploy rides in the data section.
#[contractevent(topics = ["factory", "deployed"])]
pub struct FactoryDeployed {
    #[topic]
    pub artwork_id: BytesN<32>,
    #[topic]
    pub token: Address,
    pub wasm_hash: BytesN<32>,
}

/// Emitted when the canonical implementation hash is rotated
/// (`wasm_hash.updated`) — admin-only, post re-audit (TOV-146). Old and new
/// hashes ride in the topics, mirroring the token's `proxy.upgraded` event.
#[contractevent(topics = ["wasm_hash", "updated"])]
pub struct WasmHashUpdated {
    #[topic]
    pub old_wasm_hash: BytesN<32>,
    #[topic]
    pub new_wasm_hash: BytesN<32>,
}
