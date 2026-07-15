# Tove Heritage — Smart Contracts

Soroban (Stellar) smart contracts for the Tove Heritage platform: passkey-secured
embedded smart wallets, KYC-gated fractional ownership of artworks, primary
book-build offerings, a whitelist-only secondary marketplace, and on-chain
provenance anchoring. USDC is the settlement asset; gas/reserves are sponsored so
the UX is non-crypto-native.

- **Stellar** + **Soroban** (Rust, `soroban-sdk` 26.1.0, target `wasm32v1-none`)
- **OpenZeppelin `stellar-accounts` / `stellar-tokens` / `stellar-contract-utils` 0.7.2** — audited account-abstraction, SEP-41 fungible-token, and upgradeable primitives
- **Toolchain pinned** to Rust 1.95.0 (`rust-toolchain.toml`) for byte-reproducible WASM

---

## Contract set

| Crate | Role |
|---|---|
| `tove-smart-wallet` | Passkey-bound smart wallet (OZ custom account). Holds USDC + fractions; moves only under its configured passkey/recovery signers. Upgradeable. |
| `tove-wallet-factory` | Deploys per-user wallets from the canonical wallet WASM at deterministic addresses. **Admin-gated** deploy; forces the canonical hash. |
| `tove-webauthn-verifier` | Shared secp256r1 / WebAuthn (passkey) signature verifier. Stateless, immutable. |
| `tove-ed25519-verifier` | Shared Ed25519 verifier (e.g. recovery keys). Stateless, immutable. |
| `tove-kyc-allowlist` | Admin-owned allowlist. `is_allowed(addr)` is consulted cross-contract on every inbound movement (fail-closed default). |
| `tove-emergency-freeze` | Admin-owned freeze set. `is_frozen(addr)` gates every movement (fail-closed). |
| `tove-registry-anchor` | Admin anchors one Merkle root per batch date for the off-chain provenance indexer (write-once per date). |
| `tove-fraction-token` | The economic core: SEP-41 fraction token per artwork. Compliance funnel (frozen → KYC → lockup), one-shot `mint_settle`, atomic `settle_trade` split, upgrade + invariant-gate. **One canonical bytecode for every artwork.** |
| `tove-fraction-factory` | Deploys a per-artwork FractionToken at a deterministic address (salt = `artwork_id`), **forcing the canonical token hash** (no non-canonical deploy path). Registry: `token_of(artwork_id)`. |
| `tove-marketplace-settler` | Secondary-market RFQ settler. `accept_quote` requires **both** buyer + seller native auth over the trade tuple, resolves the canonical token via the factory, and atomically drives `settle_trade` (one-shot per quote). |

`test-fixtures/tove-evil-fraction-token` is a **deliberately hostile** FractionToken the invariant-gate tests upgrade *into* — never deployed, excluded from the canonical manifest.

---

## Testnet deployment (base infrastructure)

Live persistent deployment of the base infrastructure on **Stellar testnet**
(`Test SDF Network ; September 2015`). Per-artwork FractionTokens and per-offering
OfferingEscrows are deployed **on demand** by the backend (see *Backend
integration*), not here.

> ⚠️ Testnet only — the contracts have **not** yet been through the external
> audit-firm engagement (a hard pre-mainnet gate). Testnet resets quarterly, so
> re-run `scripts/deploy_testnet.sh` to refresh these ids. Machine-readable copy:
> [`deployments/testnet-latest.env`](deployments/testnet-latest.env).

| Contract | Address |
|---|---|
| Admin (deployer, single key — rotate to multi-sig via each contract's `set_admin`) | `GCFJFGJDJMMCJFHIL7HDG3VGVTD6NCMNRWFMX6M3PA7YDRHFGF6E3LR5` |
| WebAuthn verifier | `CB5CTQGFPV42EFVVTAIGE6RMZC5YPKKSKNQCU7KGRXIZZT572GNSGR6T` |
| Ed25519 verifier | `CDORJEZW2CSEUTAOVOSS4WLACL5P5BJPHTY2TGIGSLL4X372VJTU676L` |
| Wallet factory | `CC6NIHQXMNZEJ2PWELRFEWCWSWPJRJ5FMV2PTAJLWO6JFSPQXP5PQY5P` |
| KYC allowlist | `CCNR6WXKK42KPM2ACH5M3GET3BMIJNUEEWJYEBQKEHLDI27YT5ZLNHCP` |
| Emergency freeze | `CAQEMD5FG23AGYK5HGIUW37ZNOD4MFQJ6X27IP6NVCE7R4QZEXRX47UZ` |
| Registry anchor | `CBTBVDC7XGEAAKIICP4QMS34OAZ3A7BA6P2K7WIZK4G3UKM556ZQSYTE` |
| Fraction factory | `CBIEG2HR66SFX5KG4CPEP6RPZ4JNDGGXY3NDICU37DFSWYPUUTFAHVUK` |
| Marketplace settler | `CDW5RGVHGHC3LDH3XT5Z6KK2OIOVMAH7UALCTKGXWPC5COHD732J3UTR` |

**Settlement asset (external — not deployed by us):** Circle USDC on testnet.
The value the backend passes as the `usdc` argument is the **SAC contract id**, not
the classic issuer:

| Circle USDC (testnet) | Value |
|---|---|
| USDC SAC contract id (`usdc` arg) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Classic issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Asset code / decimals | `USDC` / `7` |

SAC id is deterministic from the asset + testnet passphrase (`stellar contract id
asset --asset USDC:<issuer>`); verified live on-ledger (`decimals() == 7`). Get test
USDC from the [Circle faucet](https://faucet.circle.com) (Stellar testnet) — Circle
USDC cannot be self-minted.

Explorer: `https://stellar.expert/explorer/testnet/contract/<address>`

**Canonical WASM hashes** (installed on-ledger; both equal the committed
`wasm-manifest.txt`, so the deployed code is the reproducible, manifest-verified
bytecode):

| Executable | SHA-256 |
|---|---|
| Smart wallet (wallet-factory deploys from this) | `07234be70fd010c9bb5a4ee710d2af45a70cf530e13e2e3bb5a9cdc510206ec9` |
| Fraction token (fraction-factory deploys from this) | `7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd` |

**Wiring is verified on-chain:** `marketplace-settler.factory()` returns the
fraction-factory id; both factories carry the canonical hashes above.

---

## How it fits together

```
                    passkey (WebAuthn/Ed25519 verifier)
                              │
  wallet-factory ── deploys ──┴──▶ tove-smart-wallet  (holds USDC + fractions)
                                          │ transfer / settle counterparty
  fraction-factory ─ deploys ─▶ tove-fraction-token ◀── guard_movement consults ──▶ kyc-allowlist
        (salt = artwork_id,            │  (SEP-41 + compliance funnel)      └─▶ emergency-freeze
         canonical hash forced)        │
                                       │  mint_settle (minter = escrow)
  offering-escrow (per offering) ──────┤  settle_trade (settler = marketplace-settler)
                                       │
  marketplace-settler ── accept_quote ─┘  (dual buyer+seller auth → settle_trade)

  registry-anchor  — off-chain provenance Merkle roots, one per batch date
```

**Deploy order (enforced by dependency):** verifiers → upload wallet WASM →
wallet-factory → kyc / freeze / registry-anchor → upload token WASM →
fraction-factory → **marketplace-settler** (needs the factory). Then, per artwork,
the backend deploys a FractionToken via the factory wired with
`marketplace_settler = <settler>` and (per offering) an OfferingEscrow as that
token's `minter`.

### Settlement flows

- **Primary (book-build offering).** `OfferingEscrow` escrows `price×count` USDC per bid; `close_and_settle(clearing_price, allocations)` atomically mints the FractionToken supply, refunds losers/overpays, and splits proceeds **3% platform / 97% artist**. Two on-chain conservation invariants (Σ minted == total_supply; real USDC balance delta).
- **Secondary (RFQ marketplace).** `MarketplaceSettler.accept_quote(rfq, quote, artwork_id, buyer, seller, count, gross_usdc)` requires **both** parties to natively authorize the exact tuple, resolves the token via `factory.token_of`, records the quote one-shot, and drives `FractionToken.settle_trade` — split **1.5% platform / 1.5% artist royalty / 97% seller**, zero dust.

### Economic constants (compile-time, per canonical WASM)

| Constant | Value | Where |
|---|---|---|
| Secondary platform fee | **1.5%** (`PLATFORM_FEE_BPS = 150`) | `settle_trade` |
| Secondary artist royalty | **1.5%** (`ROYALTY_BPS = 150`) | `settle_trade` |
| Primary platform fee | **3%** (`PLATFORM_FEE_BPS = 300`) | `OfferingEscrow` |

Retentions, lockup expiries, KYC/freeze/settler/USDC addresses, and artwork
identity are **per-artwork constructor arguments**, not code.

---

## Backend integration

- **Per-artwork token:** `fraction-factory.deploy(TokenInit{ artwork_id, …, kyc_allowlist, freeze_set, marketplace_settler=<settler above>, minter, usdc=<USDC SAC id>, … })`. The factory forces the canonical hash and records `token_of(artwork_id)`. Deterministic address = `f(factory, artwork_id)`. `kyc_allowlist`/`freeze_set`/`marketplace_settler` are the base-infra ids from the table above; `usdc` is the Circle SAC id below; `minter` is the per-offering `OfferingEscrow`; `artist`/`treasury`/`artist_payout`/`proxy_admin` are business accounts.
- **USDC:** supply the USDC **SAC contract id** per token/offering (the base infra does not hard-code it — it is a per-artwork arg by design). On testnet use Circle USDC: `usdc = CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, 7 decimals). Test USDC from [faucet.circle.com](https://faucet.circle.com).
- **Passkey auth ABI (TOV-22).** The wallet's on-chain `AuthPayload` encoding the relayer must reproduce is pinned by the golden-vector test `contracts/tove-smart-wallet/src/golden_vector_test.rs`: signers sign `auth_digest = sha256(host_payload ‖ context_rule_ids.to_xdr())` (WebAuthn challenge = `base64url(auth_digest)`); the default context rule id is `0`.
- **Secondary settle:** the buyer's three `usdc.transfer(buyer, …)` auth entries inside `settle_trade` are assembled by the backend into the same transaction as the `accept_quote` call; the settler does not manufacture them.
- **Admin ops:** KYC/freeze membership, `registry-anchor.emit`, and every `set_admin`/`upgrade` are admin-gated on the addresses above.

### Typed error codes (client reference)

- **fraction-token:** `InvariantViolated=1, AlreadyMinted=2, UnauthorizedMinter=3, EmptyMint=4, RecipientNotWhitelisted=5, Frozen=6, ArtistLockupViolated=7, TreasuryLockupViolated=8, LeftoverAlreadyRecorded=9, InvalidTrade=10, MigrationPending=11, InvalidAmount=12`
- **offering-escrow:** `OfferingNotOpen=1, DuplicateBid=2, InvalidBid=3, BidNotFound=4, NotBidOwner=5, BidInactive=6, NotClosed=7, InvalidAllocation=8, UsdcAccounting=9, AlreadySettled=10, HasBids=11, TokenAlreadyBound=12, TokenNotBound=13, InvalidParams=14`
- **marketplace-settler:** `QuoteAlreadySettled=1, TokenNotFound=2`
- **fraction-factory:** `ArtworkAlreadyDeployed=1` · **registry-anchor:** `DateAlreadyAnchored=1`
- kyc/freeze mutators and mis-signed auth surface as **host Auth errors** (there is no custom `BUYER_SIG_INVALID`; a wrong signature is a native auth failure).

---

## Develop

```bash
rustup target add wasm32v1-none          # once
stellar contract build                   # produces target/wasm32v1-none/release/*.wasm
# some suites contractimport the built wallet wasm:
stellar contract optimize --wasm target/wasm32v1-none/release/tove_smart_wallet.wasm

cargo test --workspace                                   # unit + integration-tests
cargo test -p tove-wallet-factory --features integration # wasm-gated factory suite
bash scripts/build-canonical.sh --check                  # canonical WASM manifest (no drift)
bash scripts/e2e_testnet.sh                              # ephemeral full-stack testnet smoke (needs network)
```

### Deploy the base infrastructure to testnet

```bash
bash scripts/deploy_testnet.sh   # fresh friendbot-funded identity, no secrets
# → deploys the base set in dependency order, prints a summary,
#   and writes deployments/testnet-latest.env
```

---

## Testing & security posture

- Every crate ships the canonical baseline suite: constructor binding, happy paths, auth-rejection on every mutation (fail-closed, state unchanged), idempotency without re-emit, one event per state change, cross-address independence.
- Verifiers are tested with **real cryptography** (p256 / ed25519 vectors); `integration-tests/` proves the real passkey flow (factory → wallet → real verifier) and the real settle path (factory → token → settler → USDC) in one `Env`, no mocks on the exercised path.
- **CI** (`.github/workflows/ci.yml`) gates every PR on four jobs: workspace unit+integration, WASM build, **canonical-WASM determinism** (`build-canonical.sh --check`), and a **testnet e2e smoke** (fresh friendbot keypair per run, retried on network flake, no secrets).
- **Compliance is fail-closed:** `guard_movement` reads KYC/freeze cross-contract with a *hard* invoke — a dead/misconfigured gating contract traps the movement (no gating ⇒ no movement).
- **Upgrade safety:** each FractionToken upgrade seals all fund movement until `migrate()` verifies the executable's economic constants **and** a snapshot of supply, lockups, the one-shot mint flag, and a fingerprint of the write-once economic config (Usdc/Minter/ArtistPayout/Treasury/retentions/…). Corrupted state can never migrate — "sealed-forever" over laundering.
- **Internal adversarial review:** a full self-audit of all contracts found and remediated 2 High + 5 Medium + several Low findings; a follow-up multi-agent verification pass confirmed **no High/Medium issues remain**. This is pre-audit hardening, **not** a substitute for the external firm audit.

### Canonical WASM

Tove uses a **single canonical FractionToken bytecode** for every artwork — one audited executable, differing only by constructor args. `scripts/build-canonical.sh` hashes every production WASM into `wasm-manifest.txt`; the `canonical-wasm` CI job fails on any drift. The factory ignores a caller-supplied `impl_wasm_hash` and always deploys the stored canonical hash (FR-04.12), so no non-canonical (unaudited) executable can reach an artwork.

### Audit status

- **Firm:** TBD (candidates: OtterSec / Runtime Verification / Halborn). Required before any mainnet deploy.
- **Audited WASM SHA-256:** TBD (recorded post-audit, must equal the `wasm-manifest.txt` entry).

---

## Branching

- `main` — production / audited releases (protected)
- `dev` — integration
- `feature/*`, `fix/*` — work branches → PR into `dev`

Flow: `feature/* → dev → main`.
