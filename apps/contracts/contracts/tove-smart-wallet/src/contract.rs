use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    token, Address, BytesN, Env, Map, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{
    self, AuthPayload, ContextRule, ContextRuleType, ExecutionEntryPoint, Signer, SmartAccount,
    SmartAccountError,
};
use stellar_contract_utils::upgradeable::{self as upgradeable, Upgradeable};

use crate::events::TransferEvent;

#[contract]
pub struct ToveSmartWallet;

#[contractimpl]
impl ToveSmartWallet {
    /// Bind the wallet to its initial `signers` (e.g. a passkey via the WebAuthn
    /// verifier + a recovery key) and `policies`, under a default context rule.
    /// Runs once, atomically, at deploy.
    ///
    /// `signers`/`policies` is the schema the backend (TOV-21) constructs.
    pub fn __constructor(e: &Env, signers: Vec<Signer>, policies: Map<Address, Val>) {
        smart_account::add_context_rule(
            e,
            &ContextRuleType::Default,
            &String::from_str(e, "tove-wallet"),
            None,
            &signers,
            &policies,
        );
    }

    /// Move `amount` of `token` from this wallet to `to`. The wallet authorizes
    /// itself, which triggers `__check_auth` → the configured signers/policies
    /// (passkey). Emits a SEP-41-compatible transfer event.
    pub fn transfer(e: &Env, token: Address, to: Address, amount: i128) {
        let wallet = e.current_contract_address();
        wallet.require_auth();

        token::Client::new(e, &token).transfer(&wallet, &to, &amount);

        TransferEvent { from: wallet, to, token, amount }.publish(e);
    }

    /// APPEND signers to an existing context rule. Authorized by the wallet
    /// itself (routes through `__check_auth`).
    ///
    /// ⚠️ This is NOT passkey rotation/recovery, despite how tempting it looks.
    /// It only APPENDS. On a rule with NO policy (the shape the factory deploys —
    /// `policies = {}`), OZ requires ALL of a rule's signers to authorize every
    /// operation, so appending a second signer turns a 1-of-1 wallet into a
    /// **2-of-N** wallet: from then on every `transfer` / `upgrade` /
    /// `remove_signer` needs BOTH keys, and losing either one permanently
    /// freezes the wallet (even `remove_signer` needs both). A "recovery key"
    /// added this way DEFEATS recovery rather than enabling it.
    ///
    /// To actually REPLACE a lost passkey, swap within the rule: `add_signer`
    /// the new signer, then `remove_signer` the old one (both exposed via the
    /// `SmartAccount` trait, both self-authorized) — the rule returns to a
    /// single signer. For an INDEPENDENT recovery key (either key can act
    /// alone), create a SEPARATE context rule via `add_context_rule`, or attach
    /// a threshold policy so the rule is M-of-N instead of N-of-N. Reach for
    /// this batch append only when you deliberately want a multi-signer rule
    /// where every listed signer must co-sign.
    pub fn batch_add_signer(e: &Env, context_rule_id: u32, signers: Vec<Signer>) {
        e.current_contract_address().require_auth();
        smart_account::batch_add_signer(e, context_rule_id, &signers);
    }
}

#[contractimpl]
impl CustomAccountInterface for ToveSmartWallet {
    type Error = SmartAccountError;
    type Signature = AuthPayload;

    /// Delegates verification to OZ: validates the provided signatures against
    /// the configured signers/policies (secp256r1/WebAuthn handled by the
    /// referenced verifier contract). Returns `ExternalVerificationFailed` when a
    /// passkey signature does not match (the `AUTH_INVALID` case).
    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for ToveSmartWallet {}

#[contractimpl(contracttrait)]
impl ExecutionEntryPoint for ToveSmartWallet {}

#[contractimpl]
impl Upgradeable for ToveSmartWallet {
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, _operator: Address) {
        e.current_contract_address().require_auth();
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}
