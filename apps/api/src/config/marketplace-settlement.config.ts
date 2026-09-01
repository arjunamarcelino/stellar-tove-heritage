import { registerAs } from '@nestjs/config';

/**
 * Secondary-marketplace settlement config (TOV-177, FR-06.04+06.05). Powers the `is_settled` self-heal read
 * and the accept-quote settle worker. Holds NO signing secret — the accept flow's passkey signatures come
 * from the parties; the tx source/fee-payer is the relayer's account (an OPTIONAL dedicated settlement account
 * via `RELAYER_MARKETPLACE_SETTLEMENT_SECRET` in `relayer.config`, #386, else the shared account).
 * `settlerAddress` reads the SINGLE canonical env
 * var `FRACTION_MARKETPLACE_SETTLER_ADDRESS` (already baked into every FractionToken's `TokenInit`) — no
 * second env var, no equality probe. Every value has a `??` default so config-load never throws.
 */
export const marketplaceSettlementConfig = registerAs('marketplaceSettlement', () => ({
  rpcUrl:
    process.env.MARKETPLACE_SETTLEMENT_RPC_URL ??
    process.env.RELAYER_RPC_URL ??
    'https://soroban-testnet.stellar.org',
  networkPassphrase:
    process.env.MARKETPLACE_SETTLEMENT_NETWORK_PASSPHRASE ??
    process.env.RELAYER_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015',
  // Single source of truth — the same settler baked into TokenInit at fraction deploy.
  settlerAddress: process.env.FRACTION_MARKETPLACE_SETTLER_ADDRESS ?? '',
  usdcAddress: process.env.RELAYER_USDC_TOKEN_ADDRESS ?? '',
  // Per-call `is_settled` read timeout (simulate-only).
  readTimeoutMs: parseInt(process.env.MARKETPLACE_SETTLEMENT_READ_TIMEOUT_MS ?? '5000', 10),
  // Buyer passkey validity window (~120 ledgers ≈ 10 min) — passed to `buildAcceptQuote`. The seller's
  // window is per-quote (= ledgers until `validUntil`), computed by the authorize service, not here.
  acceptSigValidityLedgers: parseInt(process.env.MARKETPLACE_SETTLEMENT_ACCEPT_SIG_LEDGERS ?? '120', 10),
  // Settle-worker knobs (consumed by the deferred settle/reconcile worker, WS-F).
  settleGraceMs: parseInt(process.env.MARKETPLACE_SETTLEMENT_SETTLE_GRACE_MS ?? '120000', 10),
  reconcileEnabled: (process.env.MARKETPLACE_SETTLEMENT_RECONCILE_ENABLED ?? 'true') === 'true',
  reconcileCron: process.env.MARKETPLACE_SETTLEMENT_RECONCILE_CRON ?? '* * * * *',
  reconcileGraceMs: parseInt(process.env.MARKETPLACE_SETTLEMENT_RECONCILE_GRACE_MS ?? '180000', 10),
  reconcileBatch: parseInt(process.env.MARKETPLACE_SETTLEMENT_RECONCILE_BATCH ?? '100', 10),
}));

export type MarketplaceSettlementConfig = ReturnType<typeof marketplaceSettlementConfig>;
