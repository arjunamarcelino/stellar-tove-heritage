#![cfg(test)]
//! # SEP-41 event conformance suite (TOV-144, FR-04.10)
//!
//! Pins the exact `(contract, topics, data)` wire shape of every
//! balance/allowance event the FractionToken emits, on every emitting path,
//! and proves an off-chain indexer can rebuild balances + total supply from
//! the events alone (replay test).
//!
//! ## Pinned indexer contract (R3) — PERMANENT event ABI
//!
//! | Emitting path               | topics                                      | data                                           |
//! |-----------------------------|---------------------------------------------|------------------------------------------------|
//! | `mint_settle` (per recipient, in recipient order) | `["mint", to: Address]` | map `{ amount: i128 }`                        |
//! | `transfer`                  | `["transfer", from: Address, to: Address]`  | bare `i128` amount                             |
//! | `transfer_from`             | `["transfer", from: Address, to: Address]`  | bare `i128` amount — spender NOT in the event  |
//! | `settle_trade` fraction leg | `["transfer", seller, buyer]`               | bare `i128` count — byte-identical to `transfer` (the extra `["trade","settled",buyer,seller]` event carries economics only, never balances) |
//! | `burn`                      | `["burn", from: Address]`                   | map `{ amount: i128 }`                         |
//! | `burn_from`                 | `["burn", from: Address]`                   | map `{ amount: i128 }` — spender NOT in the event |
//! | `approve`                   | `["approve", owner: Address, spender: Address]` | map `{ amount: i128, live_until_ledger: u32 }` |
//!
//! Neither `transfer_from` nor `burn_from` emits any allowance-consumption
//! event — the allowance decrease is storage-only (OZ `spend_allowance`).
//!
//! ## Conformance verdict vs SEP-41 (sep-0041.md v0.4.1, checked verbatim)
//!
//! - `transfer`: topics + bare-`i128` data are the spec's exact non-muxed
//!   shape. COMPLIANT.
//! - `mint`: topics `["mint", to]` per spec (the historical SAC-era
//!   `["mint", admin, to]` is gone from the spec); map data is the spec's
//!   second allowed encoding — "`map` containing entries with `Symbol` keys
//!   … `amount: i128` … Other entries allowed as defined by the
//!   implementation". COMPLIANT.
//! - `burn` / `approve`: topics match the spec exactly. Data: the spec's
//!   letter lists bare `i128` (burn) and `(i128, u32)` (approve) with no map
//!   alternative, while the audited OZ base encodes both as maps keyed with
//!   the spec's own field names (`amount`, `live_until_ledger`). Deviation of
//!   ENCODING only: amounts decode with the identical `map{amount}` rule the
//!   spec itself mandates for muxed-era `transfer`/`mint` data, so any
//!   v0.4.0+-capable indexer decodes them unchanged (the replay test below is
//!   exactly that decoder). Pinned here as the permanent ABI — event-shape
//!   changes are not an option, and patching the audited OZ emit paths is out
//!   of scope by plan decision.
//!
//! Balance semantics for the replayer: `mint` +amount to `to` and +supply;
//! `burn` −amount from `from` and −supply; `transfer` moves amount from
//! `from` to `to`, supply untouched. `approve` and `trade.settled` carry no
//! balance deltas.

extern crate std;

use std::collections::HashMap;
use std::format;
use std::string::String as StdString;
use std::vec::Vec as StdVec;

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, xdr, Address, IntoVal, Map, Symbol, Val, Vec,
};

use crate::test::{allow, fund_usdc, mint_fixture, mux, settle_fixture, setup, Setup};

// ─────────────────────────────────────────────────────────────────────────────
// Pinned shape builders — these ARE the R3 table above, in code. Every
// conformance test asserts full `(contract, topics, data)` equality against
// tuples built here, so a drift in any emit path fails loudly.
// ─────────────────────────────────────────────────────────────────────────────

fn sym(s: &Setup, name: &str) -> Val {
    Symbol::new(&s.env, name).into_val(&s.env)
}

/// The OZ map-form data `{ amount: i128 }` (mint/burn events).
fn amount_map(s: &Setup, amount: i128) -> Val {
    let mut m = Map::<Symbol, Val>::new(&s.env);
    m.set(Symbol::new(&s.env, "amount"), amount.into_val(&s.env));
    m.into_val(&s.env)
}

/// SEP-41 mint: topics `["mint", to]`, data map `{ amount }`.
fn mint_event(s: &Setup, to: &Address, amount: i128) -> (Address, Vec<Val>, Val) {
    (
        s.id.clone(),
        vec![&s.env, sym(s, "mint"), to.into_val(&s.env)],
        amount_map(s, amount),
    )
}

/// SEP-41 transfer (non-muxed): topics `["transfer", from, to]`, data bare i128.
fn transfer_event(s: &Setup, from: &Address, to: &Address, amount: i128) -> (Address, Vec<Val>, Val) {
    (
        s.id.clone(),
        vec![&s.env, sym(s, "transfer"), from.into_val(&s.env), to.into_val(&s.env)],
        amount.into_val(&s.env),
    )
}

/// SEP-41 burn: topics `["burn", from]`, data map `{ amount }`.
fn burn_event(s: &Setup, from: &Address, amount: i128) -> (Address, Vec<Val>, Val) {
    (
        s.id.clone(),
        vec![&s.env, sym(s, "burn"), from.into_val(&s.env)],
        amount_map(s, amount),
    )
}

/// SEP-41 approve: topics `["approve", owner, spender]`, data map
/// `{ amount: i128, live_until_ledger: u32 }`.
fn approve_event(
    s: &Setup,
    owner: &Address,
    spender: &Address,
    amount: i128,
    live_until_ledger: u32,
) -> (Address, Vec<Val>, Val) {
    let mut m = Map::<Symbol, Val>::new(&s.env);
    m.set(Symbol::new(&s.env, "amount"), amount.into_val(&s.env));
    m.set(Symbol::new(&s.env, "live_until_ledger"), live_until_ledger.into_val(&s.env));
    (
        s.id.clone(),
        vec![&s.env, sym(s, "approve"), owner.into_val(&s.env), spender.into_val(&s.env)],
        m.into_val(&s.env),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 / AE1 — one conformance test per emitting path, full-tuple exact
// (events reflect only the most recent invocation — always asserted before
// any getter call, each client read is itself an invocation)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn mint_settle_emits_one_sep41_mint_per_recipient_in_recipient_order() {
    let s = setup();
    s.env.mock_all_auths();
    let r1 = Address::generate(&s.env);
    let r2 = Address::generate(&s.env);
    let r3 = Address::generate(&s.env);
    let recipients: Vec<(Address, i128)> =
        vec![&s.env, (r1.clone(), 600), (r2.clone(), 300), (r3.clone(), 100)];

    s.client.mint_settle(&s.minter, &recipients);

    // Three mint events, one per recipient, in EXACT recipients order — the
    // indexer may rely on event order matching the settlement distribution.
    assert_eq!(
        s.env.events().all(),
        vec![
            &s.env,
            mint_event(&s, &r1, 600),
            mint_event(&s, &r2, 300),
            mint_event(&s, &r3, 100),
        ]
    );

    assert_eq!(s.client.balance(&r1), 600);
    assert_eq!(s.client.balance(&r2), 300);
    assert_eq!(s.client.balance(&r3), 100);
    assert_eq!(s.client.total_supply(), 1000);
}

#[test]
fn transfer_emits_sep41_transfer_with_bare_i128_data() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let c = Address::generate(&s.env);
    allow(&s, &c); // KYC gating (TOV-140): destination must be whitelisted

    s.client.transfer(&a, &mux(&c), &150);

    // Exactly ONE event: the SEP-41 transfer. Bare i128 data (non-muxed).
    assert_eq!(s.env.events().all(), vec![&s.env, transfer_event(&s, &a, &c, 150)]);

    assert_eq!(s.client.balance(&a), 450);
    assert_eq!(s.client.balance(&c), 150);
}

#[test]
fn transfer_from_emits_sep41_transfer_without_spender_and_no_allowance_event() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let spender = Address::generate(&s.env);
    let dest = Address::generate(&s.env);
    allow(&s, &dest); // KYC gating (TOV-140)
    s.client.approve(&a, &spender, &200, &1000);

    s.client.transfer_from(&spender, &a, &dest, &120);

    // Exactly ONE event: a transfer indistinguishable from a direct one —
    // the spender appears nowhere, and the allowance decrease (200 → 80)
    // emits NO event (storage-only, pinned).
    assert_eq!(s.env.events().all(), vec![&s.env, transfer_event(&s, &a, &dest, 120)]);

    assert_eq!(s.client.balance(&dest), 120);
    assert_eq!(s.client.allowance(&a, &spender), 80);
}

#[test]
fn settle_trade_fraction_leg_emits_sep41_transfer_identical_to_plain_transfer() {
    let s = setup();
    s.env.mock_all_auths();
    let (seller, buyer) = settle_fixture(&s, 10_000);
    // Buyer's USDC require_auth fires in a non-root frame (token → SAC).
    s.env.mock_all_auths_allowing_non_root_auth();

    s.client.settle_trade(&buyer, &seller, &25, &10_000);

    // Filtered to the fraction token: the SEP-41 transfer leg FIRST — shaped
    // exactly like a plain `transfer` (an indexer needs no settle-special
    // case) — then `trade.settled` with the economics. The three USDC SAC
    // transfer events ride under the USDC contract id and are excluded by
    // the contract filter.
    let mut econ = Map::<Symbol, Val>::new(&s.env);
    econ.set(Symbol::new(&s.env, "count"), 25_i128.into_val(&s.env));
    econ.set(Symbol::new(&s.env, "gross_usdc"), 10_000_i128.into_val(&s.env));
    econ.set(Symbol::new(&s.env, "platform_cut"), 150_i128.into_val(&s.env));
    econ.set(Symbol::new(&s.env, "artist_cut"), 150_i128.into_val(&s.env));
    econ.set(Symbol::new(&s.env, "seller_net"), 9_700_i128.into_val(&s.env));
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.id),
        vec![
            &s.env,
            transfer_event(&s, &seller, &buyer, 25),
            (
                s.id.clone(),
                vec![
                    &s.env,
                    sym(&s, "trade"),
                    sym(&s, "settled"),
                    buyer.into_val(&s.env),
                    seller.into_val(&s.env),
                ],
                econ.into_val(&s.env),
            ),
        ]
    );

    assert_eq!(s.client.balance(&seller), 575);
    assert_eq!(s.client.balance(&buyer), 25);
}

#[test]
fn burn_emits_sep41_burn_event() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);

    s.client.burn(&a, &100);

    // Exactly ONE event: topics ["burn", from], data map { amount }.
    assert_eq!(s.env.events().all(), vec![&s.env, burn_event(&s, &a, 100)]);

    assert_eq!(s.client.balance(&a), 500);
    assert_eq!(s.client.total_supply(), 900);
}

#[test]
fn burn_from_emits_sep41_burn_without_spender_and_no_allowance_event() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let spender = Address::generate(&s.env);
    s.client.approve(&a, &spender, &80, &1000);

    s.client.burn_from(&spender, &a, &80);

    // Exactly ONE event: a burn indistinguishable from a direct one — the
    // spender appears nowhere, the allowance consumption emits nothing.
    assert_eq!(s.env.events().all(), vec![&s.env, burn_event(&s, &a, 80)]);

    assert_eq!(s.client.balance(&a), 520);
    assert_eq!(s.client.total_supply(), 920);
    assert_eq!(s.client.allowance(&a, &spender), 0);
}

#[test]
fn approve_emits_sep41_approve_event_with_amount_and_live_until_ledger() {
    let s = setup();
    s.env.mock_all_auths();
    let (a, _b) = mint_fixture(&s);
    let spender = Address::generate(&s.env);

    s.client.approve(&a, &spender, &200, &1000);

    // Exactly ONE event: topics ["approve", owner, spender], data map
    // { amount: i128, live_until_ledger: u32 }.
    assert_eq!(
        s.env.events().all(),
        vec![&s.env, approve_event(&s, &a, &spender, 200, 1000)]
    );

    assert_eq!(s.client.allowance(&a, &spender), 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 / AE2 — indexer replay: balances + supply rebuilt from events alone
// ─────────────────────────────────────────────────────────────────────────────

/// Append this invocation's fraction-token events (contract-filtered — USDC
/// SAC events excluded) to the replay log. Must run IMMEDIATELY after each
/// token call: `events().all()` reflects only the most recent invocation.
fn collect_token_events(s: &Setup, log: &mut StdVec<xdr::ContractEvent>) {
    log.extend(
        s.env.events().all().filter_by_contract(&s.id).events().iter().cloned(),
    );
}

/// Stable per-address key for the std HashMap (soroban `Address` has no
/// `Hash`): the Debug form of the XDR `ScAddress`, derivable identically
/// from an event topic and from a live `Address`.
fn addr_key(v: &xdr::ScVal) -> StdString {
    match v {
        xdr::ScVal::Address(a) => format!("{a:?}"),
        other => panic!("topic is not an Address: {other:?}"),
    }
}

fn chain_key(a: &Address) -> StdString {
    format!("{:?}", xdr::ScAddress::from(a))
}

fn topic0(v: &xdr::ScVal) -> StdString {
    match v {
        xdr::ScVal::Symbol(sym) => sym.to_utf8_string_lossy(),
        other => panic!("topic[0] is not a Symbol: {other:?}"),
    }
}

/// The SEP-41 v0.4.0+ amount decode rule an indexer needs anyway for
/// muxed-era transfer/mint data: bare `i128`, or a map with an `amount: i128`
/// entry. (This is the exact path that also decodes the OZ map-form
/// burn data — see the module-doc conformance verdict.)
fn sep41_amount(data: &xdr::ScVal) -> i128 {
    match data {
        xdr::ScVal::I128(parts) => i128::from(parts),
        xdr::ScVal::Map(Some(map)) => {
            for entry in map.iter() {
                if let (xdr::ScVal::Symbol(k), xdr::ScVal::I128(parts)) = (&entry.key, &entry.val)
                {
                    if k.to_utf8_string_lossy() == "amount" {
                        return i128::from(parts);
                    }
                }
            }
            panic!("map event data without an i128 `amount` entry: {data:?}");
        }
        other => panic!("undecodable SEP-41 amount data: {other:?}"),
    }
}

#[test]
fn replaying_all_emitted_events_reconstructs_every_balance_and_total_supply() {
    let s = setup();
    s.env.mock_all_auths();

    // Cast + gating arranged up-front (gating/SAC admin calls emit under
    // their own contract ids and never enter the fraction-token log).
    let c = Address::generate(&s.env); // plain transfer destination
    let spender = Address::generate(&s.env);
    let dest = Address::generate(&s.env); // transfer_from destination
    let buyer = Address::generate(&s.env); // settle_trade buyer
    allow(&s, &c);
    allow(&s, &dest);
    allow(&s, &buyer);
    fund_usdc(&s, &buyer, 10_000);

    // Mixed sequence, collecting the fraction token's events after every
    // invocation: mint(600/400) → transfer 100 → approve + transfer_from 50
    // → settle_trade 50 @ gross 10_000 (real SAC legs) → burn 10.
    let mut log: StdVec<xdr::ContractEvent> = StdVec::new();

    let (a, b) = mint_fixture(&s); // 600 → a, 400 → b
    collect_token_events(&s, &mut log);

    s.client.transfer(&a, &mux(&c), &100);
    collect_token_events(&s, &mut log);

    s.client.approve(&a, &spender, &50, &1000);
    collect_token_events(&s, &mut log);

    s.client.transfer_from(&spender, &a, &dest, &50);
    collect_token_events(&s, &mut log);

    s.env.mock_all_auths_allowing_non_root_auth(); // buyer USDC auth, non-root frame
    s.client.settle_trade(&buyer, &a, &50, &10_000);
    collect_token_events(&s, &mut log);

    s.client.burn(&b, &10);
    collect_token_events(&s, &mut log);

    // 2 mint + transfer + approve + transfer + (transfer + trade.settled)
    // + burn — nothing missing, nothing foreign (USDC excluded by filter).
    assert_eq!(log.len(), 8);

    // ── Replay: the pinned indexer interpretation of the R3 table ──────────
    let mut balances: HashMap<StdString, i128> = HashMap::new();
    let mut supply: i128 = 0;
    for event in &log {
        let xdr::ContractEventBody::V0(body) = &event.body;
        let topics = &body.topics;
        match topic0(&topics[0]).as_str() {
            "mint" => {
                let amount = sep41_amount(&body.data);
                *balances.entry(addr_key(&topics[1])).or_insert(0) += amount;
                supply += amount;
            }
            "transfer" => {
                let amount = sep41_amount(&body.data);
                *balances.entry(addr_key(&topics[1])).or_insert(0) -= amount;
                *balances.entry(addr_key(&topics[2])).or_insert(0) += amount;
            }
            "burn" => {
                let amount = sep41_amount(&body.data);
                *balances.entry(addr_key(&topics[1])).or_insert(0) -= amount;
                supply -= amount;
            }
            // Non-balance events, ignored by a balance indexer: allowance
            // (approve) and trade economics (trade.settled).
            "approve" | "trade" => {}
            other => panic!("unexpected fraction-token event topic: {other}"),
        }
    }

    // Reconstructed state == on-chain state, for EVERY touched address.
    for (who, name) in [
        (&a, "a"),
        (&b, "b"),
        (&c, "c"),
        (&dest, "dest"),
        (&spender, "spender"),
        (&buyer, "buyer"),
    ] {
        assert_eq!(
            balances.get(&chain_key(who)).copied().unwrap_or(0),
            s.client.balance(who),
            "replayed balance diverges from on-chain balance for {name}",
        );
    }
    assert_eq!(supply, s.client.total_supply());

    // The exact figures, for the reader: a 600−100−50−50, b 400−10.
    assert_eq!(s.client.balance(&a), 400);
    assert_eq!(s.client.balance(&b), 390);
    assert_eq!(s.client.balance(&c), 100);
    assert_eq!(s.client.balance(&dest), 50);
    assert_eq!(s.client.balance(&buyer), 50);
    assert_eq!(s.client.total_supply(), 990);
}
