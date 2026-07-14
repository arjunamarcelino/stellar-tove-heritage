use soroban_sdk::{contractevent, Address};

/// SEP-41-compatible transfer event emitted when the wallet moves a token.
#[contractevent(topics = ["transfer"])]
pub struct TransferEvent {
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
}
