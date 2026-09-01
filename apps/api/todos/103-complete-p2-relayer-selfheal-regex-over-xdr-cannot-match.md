---
status: complete
priority: p2
issue_id: 103
tags: [code-review, correctness, blockchain, relayer, self-heal, TOV-21]
dependencies: []
---

# Relayer reactive self-heal matches a regex over base64 XDR — can't fire at submit/poll (and the unit test masks it)

## Problem Statement
The reactive "already deployed" self-heal decides success by running the regex
`/existingvalue|already[_ ]?exist/i` over a stringified error detail (`classifyDeployError`
→ `safeStringify`). That works at the **simulate/prepare** stage, where `prepareTransaction`
rejects with an `Error` whose `.message` carries readable host text (`HostError: Error(Storage,
ExistingValue)`). But at the **submit** path (`sent.errorResult` / `sent.diagnosticEvents`,
`:169`) and the **poll-FAILED** path (`resp.resultXdr`, `:186`) the detail is an XDR object that
`safeStringify` serializes via `toXDR('base64')` — an opaque base64 blob the regex can **never**
match. So the documented "an 'already exists' revert at simulate/submit → success" self-heal only
fires at simulate.

Two consequences:
1. **Concurrent same-credential loser gets a 503 (+ burns a fee).** Two `finish` submits race:
   both pass the pre-deploy `walletExists` check (outside the lock), A deploys and releases the lock
   before ledger-apply, B simulates while the wallet still doesn't exist on-chain → B submits a
   second `deploy_wallet` with the same salt → at apply B fails `ExistingValue`, surfacing through
   the **poll path** as XDR → regex misses → generic `WALLET_DEPLOY_FAILED` (503). B must retry
   (succeeds once `walletExists` returns true), and B's duplicate tx paid a now-burned fee on an
   unauthenticated, fee-spending endpoint.
2. **False-success risk (low-probability).** Conversely, if any genuine failure's diagnostic text
   happens to contain the substring, the catch returns `{ contractAddress: derived, txHash: '' }` as
   success for a wallet that was **never deployed** — `finish` then persists that `contractAddress`
   and mints tokens. The pre-deploy branch (`walletExists`, a real on-chain check) never does this;
   only the new string-inference branch can.
3. **The unit test gives false confidence:** `soroban-relayer.service.spec.ts:137-141` feeds
   `errorResult: new Error('already exists')`, which is **not** the XDR shape the SDK actually
   produces — so the "self-heals on send ERROR" test passes against a fiction.

Testnet-bounded (rare at current volume, retriable) — hence P2, not P1 — but it undercuts the
central idempotency AC (todos 094/102) under concurrency.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:234-240` (`classifyDeployError`) + `:242-256`
  (`safeStringify` `toXDR('base64')` branch) + call sites `:169`, `:186`.
- Catch/return: `:104-110`. Pre-deploy on-chain check that DOES work: `:87` (`walletExists`).
- Misleading test: `test/unit/modules/relayer/soroban-relayer.service.spec.ts:137-141`.

## Proposed Solutions

### Option A: Make on-chain state authoritative — re-check `walletExists` before classifying (recommended)
Before treating a prepare/submit/poll failure as terminal, re-run `walletExists(derived)`; if the
contract now exists on-chain, self-heal to `derived`; otherwise rethrow as `WALLET_DEPLOY_FAILED`.
Removes all reliance on error-string sniffing, fixes both the concurrent-loser 503 and the
false-success risk in one move. Update the unit test to drive the self-heal via a `getLedgerEntries`
"now present" result, not a fake `Error`.
- **Effort:** Small · **Risk:** Low

### Option B: Decode the result code instead of regex-over-base64
Inspect the decoded transaction result / diagnostic `sc_error` code for the contract-creation
`ExistingValue` rather than a text match. More faithful, but more SDK-version-coupled than A.
- **Effort:** Medium · **Risk:** Medium

### Option C: Keep simulate-only classification, document the limitation
Drop the submit/poll-path classification, document that reactive self-heal is simulate-stage only
(existence-check covers the rest), and fix the test to reflect reality. Least code, but leaves the
concurrent-loser 503 + wasted fee.
- **Effort:** Small · **Risk:** Low (accepts the gap)

## Recommended Action
**RESOLVED — Option A (on-chain state authoritative).** On ANY deploy failure the outer catch now
re-runs `walletExists(derived)`; it self-heals to the derived address only if the contract actually
exists on-chain, otherwise it rethrows as a genuine failure. Removed the error-string machinery
entirely: deleted `classifyDeployError`, the `AlreadyDeployedError` sentinel, and `safeStringify`
(which regex-matched over base64 XDR that could never match). `buildAndSubmit`/`pollForResult` now
throw plain errors (with a `warn` log carrying the send/tx status for diagnostics). This closes both
the concurrent-collision 503 + wasted-fee path and the false-success risk in one move, and it
subsumes the poll-path collision handling for todos 104/105.

## Resolution (2026-07-03)
- `src/modules/relayer/soroban-relayer.service.ts`:
  - Catch block re-checks `await this.walletExists(derived)` → self-heal or rethrow (was
    `err instanceof AlreadyDeployedError`).
  - Removed `AlreadyDeployedError`, `classifyDeployError`, `safeStringify` (~35 LOC).
  - `buildAndSubmit`: `prepareTransaction` now un-try/caught (properly typed `const prepared`, also
    resolves 107#1); send-ERROR throws a plain error after a `warn`.
  - `pollForResult`: non-SUCCESS throws a plain error after a `warn`.
- `test/unit/modules/relayer/soroban-relayer.service.spec.ts`: self-heal tests now drive
  `getLedgerEntries` (`[]` on the initial check, then present on the re-check) instead of a fake
  `Error('already exists')`. New regression test: a send/poll collision with an **opaque XDR**
  `errorResult` (`{ toXDR: () => 'base64blob' }`) self-heals via the re-check — the exact case the old
  regex-over-base64 missed. Non-collision throws assert the wallet stays absent on re-check.
- Verified: lint clean, `yarn build` 0 issues, relayer unit spec 10/10, full unit suite 247 passed.

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts`; test:
  `test/unit/modules/relayer/soroban-relayer.service.spec.ts`.

## Acceptance Criteria
- [x] A concurrent same-credential collision surfacing at submit/poll self-heals to the derived address (no 503), verified by a test using a realistic (opaque XDR) result shape (not `new Error('already exists')`).
- [x] A genuine deploy failure is NOT self-healed — on-chain `walletExists` is the authority (error text is never parsed).
- [x] The gated live-testnet test is unaffected (self-heal path unchanged in shape; derivation untouched).

## Work Log
- 2026-07-03: Filed from the factory-deploy multi-agent review (converged finding across kieran-typescript, security-sentinel, performance-oracle, code-simplicity reviewers).
- 2026-07-03: **Resolved** via Option A (walletExists re-check) — see Resolution above. Committed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
- Related: todos 094, 102, 104, 105
- Doc: docs/solutions/integration-issues/soroban-factory-deploy-wallet-encoding-and-derivation.md
