# Tove Heritage

Monorepo for **Tove Heritage** — an art-tokenization web3 project on the
**Stellar** network (Soroban smart contracts).

This is the initial scaffold: minimal fresh apps wired into one pnpm + Turborepo
workspace. Business logic lands in follow-up PRs.

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
