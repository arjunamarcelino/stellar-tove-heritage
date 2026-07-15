use soroban_sdk::{
    contract, contractimpl, symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
};
use stellar_contract_utils::upgradeable::{self as upgradeable};

use crate::error::Error;
use crate::events::TradeSettled;
use crate::storage::{extend_instance_ttl, extend_settled_ttl, DataKey};

#[contract]
pub struct MarketplaceSettler;

#[contractimpl]
impl MarketplaceSettler {
    /// Bind the settler to its `admin` (upgrade authority) and the `factory`
    /// (canonical `artwork_id → token` resolver). Runs once, atomically, at
    /// deploy — the settler must exist before any FractionToken is deployed with
    /// `marketplace_settler = this address`.
    pub fn __constructor(env: &Env, admin: Address, factory: Address) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Factory, &factory);
        extend_instance_ttl(env);
    }

    /// Settle one agreed RFQ secondary trade.
    ///
    /// Permissionless to call — security is the two required auths, not the
    /// caller. Both `buyer` and `seller` must have authorized the EXACT tuple
    /// `(rfq_id, quote_id, artwork_id, count, gross_usdc)`; a signature over any
    /// other values does not authorize this trade (surfaces as a host Auth
    /// error). The token is resolved canonically from `artwork_id` via the
    /// factory — no caller-supplied token address is trusted. The settlement is
    /// one-shot per `(rfq_id, quote_id)`.
    ///
    /// Flow (checks-effects-interactions): one-shot guard → canonical token
    /// resolution → both auths → record the marker → invoke `settle_trade` →
    /// event. `settle_trade`'s `settler.require_auth()` is satisfied by this
    /// contract's invoker frame; on any sub-step failure the whole tx reverts
    /// atomically (the marker with it).
    pub fn accept_quote(
        env: &Env,
        rfq_id: BytesN<32>,
        quote_id: BytesN<32>,
        artwork_id: BytesN<32>,
        buyer: Address,
        seller: Address,
        count: i128,
        gross_usdc: i128,
    ) -> Result<(), Error> {
        // 1. One-shot guard (R4) — cheap, fails fast on replay.
        if env
            .storage()
            .persistent()
            .has(&DataKey::Settled(rfq_id.clone(), quote_id.clone()))
        {
            return Err(Error::QuoteAlreadySettled);
        }

        // 2. Canonical token resolution via the factory (R3). A pure read of a
        //    trusted contract; None ⇒ no token deployed for this artwork.
        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let token: Address = env
            .invoke_contract::<Option<Address>>(
                &factory,
                &symbol_short!("token_of"),
                vec![env, artwork_id.clone().into_val(env)],
            )
            .ok_or(Error::TokenNotFound)?;

        // 3. Both parties bind the exact economic tuple (R2). Mis-sign on either
        //    side → host Auth error. The seller's auth is the SOLE guard on the
        //    token's internal (seller-auth-less) fraction leg.
        let auth_args: Vec<Val> = vec![
            env,
            rfq_id.clone().into_val(env),
            quote_id.clone().into_val(env),
            artwork_id.clone().into_val(env),
            count.into_val(env),
            gross_usdc.into_val(env),
        ];
        buyer.require_auth_for_args(auth_args.clone());
        seller.require_auth_for_args(auth_args);

        // 4. EFFECT before INTERACTION (CEI): record the one-shot marker so a
        //    reentrant accept_quote on the same pair hits QuoteAlreadySettled.
        env.storage()
            .persistent()
            .set(&DataKey::Settled(rfq_id.clone(), quote_id.clone()), &true);
        extend_settled_ttl(env, &rfq_id, &quote_id);

        // 5. INTERACTION: atomically drive the token's settle_trade. It returns
        //    Result<(), Error>; on Err the host propagates as a trap → the whole
        //    tx (incl. the marker in step 4) reverts.
        env.invoke_contract::<()>(
            &token,
            &Symbol::new(env, "settle_trade"),
            vec![
                env,
                buyer.clone().into_val(env),
                seller.clone().into_val(env),
                count.into_val(env),
                gross_usdc.into_val(env),
            ],
        );

        // 6. Event + TTL.
        TradeSettled {
            rfq_id,
            quote_id,
            artwork_id,
            token,
            buyer,
            seller,
            count,
            gross_usdc,
        }
        .publish(env);
        extend_instance_ttl(env);
        Ok(())
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /// Upgrade the singleton to `new_wasm_hash` (admin-only). No invariant seal
    /// — the settler holds no economic constants, and the persistent `Settled`
    /// records survive the WASM swap automatically.
    pub fn upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
        require_admin(env);
        upgradeable::upgrade(env, &new_wasm_hash);
        extend_instance_ttl(env);
    }

    /// Rotate the admin authority (e.g. single key → multi-sig account).
    /// Admin-only.
    pub fn set_admin(env: &Env, new_admin: Address) {
        require_admin(env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        extend_instance_ttl(env);
    }

    // ── Getters (refresh instance TTL on read, M5) ───────────────────────────

    /// The current admin authority.
    pub fn admin(env: &Env) -> Address {
        extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// The canonical fraction-factory address.
    pub fn factory(env: &Env) -> Address {
        extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::Factory).unwrap()
    }

    /// Whether a `(rfq_id, quote_id)` has been settled. Refreshes the marker's
    /// TTL when present so an actively-consulted record stays live.
    pub fn is_settled(env: &Env, rfq_id: BytesN<32>, quote_id: BytesN<32>) -> bool {
        extend_instance_ttl(env);
        let settled = env
            .storage()
            .persistent()
            .has(&DataKey::Settled(rfq_id.clone(), quote_id.clone()));
        if settled {
            extend_settled_ttl(env, &rfq_id, &quote_id);
        }
        settled
    }
}

/// Assert the direct caller is the stored admin (host auth).
fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}
