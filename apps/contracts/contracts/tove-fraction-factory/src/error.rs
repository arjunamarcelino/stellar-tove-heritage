use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `deploy` was called for an `artwork_id` that already has a token in
    /// the registry; a FractionToken is deployed exactly once per artwork and
    /// the registry entry is never overwritten.
    ArtworkAlreadyDeployed = 1,
}
