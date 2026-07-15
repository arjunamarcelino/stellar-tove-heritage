use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted when an address is frozen (`freeze.added`). `reason_hash` is the hash
/// of the off-chain human-readable reason.
#[contractevent(topics = ["freeze", "added"])]
pub struct FreezeAdded {
    pub addr: Address,
    pub reason_hash: BytesN<32>,
}

/// Emitted when an address is unfrozen (`freeze.removed`).
#[contractevent(topics = ["freeze", "removed"])]
pub struct FreezeRemoved {
    pub addr: Address,
    pub reason_hash: BytesN<32>,
}
