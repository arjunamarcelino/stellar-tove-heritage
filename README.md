# Tove Heritage

Monorepo for **Tove Heritage** — an art-tokenization web3 project on the
**Stellar** network (Soroban smart contracts).

This is the initial scaffold: minimal fresh apps wired into one pnpm + Turborepo
workspace. Business logic lands in follow-up PRs.

## Live deployment

| Surface      | URL                                                              |
| ------------ | ---------------------------------------------------------------- |
| Landing page | [stellar.toveheritage.org](http://stellar.toveheritage.org/)     |
| Web app      | [stellar-app.toveheritage.org](http://stellar-app.toveheritage.org/) |

### On-chain contract

Primary token contract on the **Stellar testnet**:

- **USDC (mock) token:** `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

The platform's base infrastructure is deployed by `scripts/deploy_testnet.sh`
(testnet resets quarterly):

| Contract               | Address                                                    |
| ---------------------- | ---------------------------------------------------------- |
| USDC Mock (token)      | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Wallet Factory         | `CC6NIHQXMNZEJ2PWELRFEWCWSWPJRJ5FMV2PTAJLWO6JFSPQXP5PQY5P` |
| Fraction Factory       | `CBIEG2HR66SFX5KG4CPEP6RPZ4JNDGGXY3NDICU37DFSWYPUUTFAHVUK` |
| Marketplace Settler    | `CDW5RGVHGHC3LDH3XT5Z6KK2OIOVMAH7UALCTKGXWPC5COHD732J3UTR` |
| KYC Allowlist          | `CCNR6WXKK42KPM2ACH5M3GET3BMIJNUEEWJYEBQKEHLDI27YT5ZLNHCP` |
| Emergency Freeze       | `CAQEMD5FG23AGYK5HGIUW37ZNOD4MFQJ6X27IP6NVCE7R4QZEXRX47UZ` |
| Registry Anchor        | `CBTBVDC7XGEAAKIICP4QMS34OAZ3A7BA6P2K7WIZK4G3UKM556ZQSYTE` |
| WebAuthn Verifier      | `CB5CTQGFPV42EFVVTAIGE6RMZC5YPKKSKNQCU7KGRXIZZT572GNSGR6T` |
| Ed25519 Verifier       | `CDORJEZW2CSEUTAOVOSS4WLACL5P5BJPHTY2TGIGSLL4X372VJTU676L` |

Network parameters:

- **Network:** testnet
- **RPC URL:** `https://soroban-testnet.stellar.org`
- **Passphrase:** `Test SDF Network ; September 2015`
- **Admin:** `GCFJFGJDJMMCJFHIL7HDG3VGVTD6NCMNRWFMX6M3PA7YDRHFGF6E3LR5`

## Structure

```
apps/
  web/        Next.js 16 frontend            (@tove/web)
  api/        NestJS 11 backend API          (@tove/api)
  contracts/  Soroban (Rust) smart contract  — built outside Turbo
```

## Prerequisites

- **Node** ≥ 22 (LTS 24 recommended — see `.nvmrc`)
- **pnpm** ≥ 10 (`corepack enable` or install from https://pnpm.io)
- For `apps/contracts` only:
  - **Rust** ≥ 1.84 (`rustup update stable`)
  - wasm target: `rustup target add wasm32v1-none`
  - **Stellar CLI**: `cargo install --locked stellar-cli` or `brew install stellar-cli`

## Getting started (web + api)

```bash
pnpm install
pnpm dev        # web → http://localhost:3000, api → http://localhost:3001
pnpm build      # build all JS apps
pnpm lint
pnpm check-types
```

Per-app commands:

```bash
pnpm --filter @tove/web dev
pnpm --filter @tove/api start
```

## Smart contract (apps/contracts)

Built with the Rust/Stellar toolchain, **outside** Turborepo. See
[`apps/contracts/README.md`](apps/contracts/README.md).

```bash
cd apps/contracts
stellar contract build      # → target/wasm32v1-none/release/*.wasm
cargo test
```

## Secret boundary (important)

- `apps/web` holds **public values only** (network passphrase, RPC URL, public
  contract/issuer IDs). Next.js inlines every `NEXT_PUBLIC_*` var into the client
  bundle — **never** put a signing or admin secret there.
- Signing/admin keys live server-side (`apps/api`) or in the Stellar CLI identity
  store. Never commit a raw `S...` secret key or a populated `.env` (only
  `.env.example` with empty values).

## Toolchain notes

- Node/pnpm versions are pinned via `engines`, `packageManager`, and `.nvmrc`.
- Tasks are orchestrated by Turborepo (`turbo.json`); the Rust contract is
  intentionally excluded from the JS pipeline.
