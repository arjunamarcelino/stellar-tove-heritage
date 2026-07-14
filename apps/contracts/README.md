# @tove contracts — Soroban (Stellar)

Rust/Soroban smart contracts for Tove Heritage. Built with the Stellar/Rust
toolchain, **outside** Turborepo (this directory has no `package.json`, so pnpm
ignores it).

> ⚠️ Scaffolded by hand and **not yet built/tested** — the Rust toolchain and
> Stellar CLI must be installed to verify (see below).

## Prerequisites

```bash
rustup update stable                 # ensure >= 1.84
rustup target add wasm32v1-none      # NOTE: not wasm32-unknown-unknown
cargo install --locked stellar-cli   # or: brew install stellar-cli
stellar --version                    # confirm the CLI is on PATH
```

## Layout

```
apps/contracts/
├── Cargo.toml                 # [workspace] root
├── Cargo.lock                 # committed (deployable, not a library)
├── rust-toolchain.toml        # pins channel + wasm32v1-none target
└── contracts/
    └── hello_world/           # smoke-test contract (placeholder)
        ├── Cargo.toml
        └── src/{lib.rs, test.rs}
```

## Build & test

```bash
stellar contract build     # → target/wasm32v1-none/release/hello_world.wasm
cargo test                 # native unit tests (uses soroban-sdk testutils)
```

## Deploy to testnet

```bash
stellar keys generate alice --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/hello_world.wasm \
  --source-account alice --network testnet --alias hello_world
```

## Security notes (read before writing `art_token`)

- `hello_world` is an **unauthenticated placeholder** — never deploy it as
  anything privileged.
- When `art_token` lands, gate mint/admin entrypoints on `require_auth`.
- Prefer the [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts)
  fungible/NFT modules over hand-rolled token logic.
- Never paste a raw `S...` secret key into code, README, or `.env` (use
  `.env.example` with empty values; the Stellar CLI stores keys under `.stellar/`,
  which is git-ignored).
