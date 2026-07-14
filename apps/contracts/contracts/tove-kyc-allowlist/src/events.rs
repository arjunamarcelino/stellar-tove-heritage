use soroban_sdk::{contractevent, Address};

/// Emitted when an address is added to the allowlist (`kyc.added`).
#[contractevent(topics = ["kyc", "added"])]
pub struct KycAdded {
    pub addr: Address,
}

/// Emitted when an address is removed from the allowlist (`kyc.removed`).
#[contractevent(topics = ["kyc", "removed"])]
pub struct KycRemoved {
    pub addr: Address,
}
