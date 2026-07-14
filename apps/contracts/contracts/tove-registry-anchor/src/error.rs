use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `emit` was called for a `batch_date` that already holds a root; an
    /// anchor is written exactly once per date and never overwritten.
    DateAlreadyAnchored = 1,
}
