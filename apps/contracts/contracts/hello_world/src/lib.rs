#![no_std]
use soroban_sdk::{contract, contractimpl, vec, Env, String, Vec};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// Smoke-test entrypoint. Unauthenticated placeholder — never deploy this as
    /// anything privileged. The real `art_token` contract lands in a follow-up.
    pub fn hello(env: Env, to: String) -> Vec<String> {
        vec![&env, String::from_str(&env, "Hello"), to]
    }
}

mod test;
