import { registerAs } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { OFFERING_MAX_BIDS_DEFAULT } from './offering-bid.config';

/**
 * Offering escrow deploy + multi-sig approval config (TOV-154, FR-05.02). The backend deploys a
 * per-offering escrow contract by invoking `Operation.createCustomContract` (constructor args baked
 * in) once a 2-of-3 admin quorum has approved, mirroring `fraction-factory.config.ts`.
 *
 * ONE signing seed (`adminSecret`, `OFFERING_ESCROW_ADMIN_SECRET`): the escrow admin AND the tx
 * source/fee account (admin-as-source, D7). Because the admin is the source, the contract's
 * `admin.require_auth()` is satisfied by the source-account (envelope) signature — no separate
 * `authorizeEntry`. The seed is attached NON-ENUMERABLE so it can't leak via logging / JSON.stringify
 * / spread / Object.keys; only the derived `adminPublicKey` is exposed (the boot-probe target — the
 * account must be XLM-funded).
 *
 * The approval quorum lives here too: `signers` is the CSV roster of admin UUIDs
 * (`OFFERING_APPROVAL_SIGNERS`, "the 3"), `threshold` is "the 2" (`OFFERING_APPROVAL_THRESHOLD`), and
 * `ttlDays` is the approval expiry window. Invariants Joi can't express are asserted in the factory
 * (fail-fast at boot): threshold must not exceed the roster size, the roster must be distinct, and
 * every entry must be a UUID.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const offeringEscrowConfig = registerAs('offeringEscrow', () => {
  const adminSecret = process.env.OFFERING_ESCROW_ADMIN_SECRET ?? '';
  const signers = (process.env.OFFERING_APPROVAL_SIGNERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const threshold = parseInt(process.env.OFFERING_APPROVAL_THRESHOLD ?? '2', 10);

  // Config-factory boot assertions — invariants Joi can't express (plus a defense-in-depth floor). Crash-
  // loop at boot rather than silently accept a single-sig collapse (threshold < 2), a quorum that can never
  // be met (threshold > roster), or a roster that double-counts / misidentifies a signer.
  if (threshold < 2) {
    throw new Error(
      `OFFERING_APPROVAL_THRESHOLD (${threshold}) must be at least 2 — a threshold of 1 defeats the multi-sig`,
    );
  }
  if (threshold > signers.length) {
    throw new Error(
      `OFFERING_APPROVAL_THRESHOLD (${threshold}) exceeds OFFERING_APPROVAL_SIGNERS count (${signers.length})`,
    );
  }
  if (new Set(signers).size !== signers.length) {
    throw new Error('OFFERING_APPROVAL_SIGNERS contains duplicate admin UUIDs');
  }
  const bad = signers.find((s) => !UUID_RE.test(s));
  if (bad) {
    throw new Error(`OFFERING_APPROVAL_SIGNERS contains a non-UUID entry: ${bad}`);
  }

  const cfg = {
    rpcUrl: process.env.OFFERING_ESCROW_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.OFFERING_ESCROW_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    // Derived pubkey — logging-safe identity + the boot-probe target (must be funded on-chain).
    adminPublicKey: adminSecret ? Keypair.fromSecret(adminSecret).publicKey() : '',
    // Canonical offering-escrow WASM hash (hex 64) the deploy pins; self-heal asserts on-chain == this.
    // Normalized to lowercase (todo 292): Joi `.hex()` accepts uppercase, but the on-chain hash comes from
    // `Buffer.toString('hex')` (always lowercase), so an upper/mixed-case env value would deploy fine yet
    // fail the case-sensitive self-heal compare on every retry.
    wasmHash: (process.env.OFFERING_ESCROW_WASM_HASH ?? '').toLowerCase(),
    // Base-infra addresses baked into every escrow constructor.
    usdcAddress: process.env.OFFERING_ESCROW_USDC_ADDRESS ?? '',
    treasuryAddress: process.env.OFFERING_ESCROW_TREASURY_ADDRESS ?? '',
    // Confirmation poll ceiling (ms). The Redis lock TTL is DERIVED from this + the fixed RPC bounds
    // (todo 285) — there is no separate deploy-timeout knob (it bounded no real call).
    pollTimeoutMs: parseInt(process.env.OFFERING_ESCROW_POLL_TIMEOUT_MS ?? '30000', 10),
    // Fee ceiling (stroops) for the deploy tx (todo 287) — asserted before signing so an inflated
    // simulation fee from a bad RPC can't drain the shared admin account. Mirrors RELAYER_MAX_TX_FEE.
    maxTxFee: parseInt(process.env.OFFERING_ESCROW_MAX_TX_FEE ?? '10000000', 10),
    probeOnBoot: (process.env.OFFERING_ESCROW_BOOT_PROBE ?? 'true') === 'true',
    // Window-open + expiry reconcile sweeper. Disabled in tests.
    reconcileEnabled: (process.env.OFFERING_ESCROW_RECONCILE_ENABLED ?? 'true') === 'true',
    // TOV-160 #334: the stale-`subscribed` settle reconcile has its OWN enable toggle (money-settlement
    // recovery is a distinct risk surface from the deploy sweep), defaulting to the deploy toggle when unset.
    settleReconcileEnabled:
      (process.env.OFFERING_SETTLE_RECONCILE_ENABLED ??
        process.env.OFFERING_ESCROW_RECONCILE_ENABLED ??
        'true') === 'true',
    reconcileCron: process.env.OFFERING_ESCROW_RECONCILE_CRON ?? '*/1 * * * *',
    reconcileBatch: parseInt(process.env.OFFERING_ESCROW_RECONCILE_BATCH ?? '20', 10),
    // A row stuck in `deploying` longer than this (no live job — e.g. a crash between the approve commit
    // and the enqueue, or attempts exhaustion) is re-driven by the stale-deploying reconcile sweep. Must
    // exceed the worst-case single-deploy wall-clock (processor lockDuration is 90s).
    deployGraceMs: parseInt(process.env.OFFERING_ESCROW_DEPLOY_GRACE_MS ?? '120000', 10),
    // ── TOV-160 settlement (FR-05.05) ──
    // Hard ceiling on ACTIVE bids per offering (enforced at bid submission). The on-chain close_and_settle
    // refunds EVERY active bid in ONE atomic tx, so the book size is bound by write-ledger-entries per tx
    // (~tens on mainnet). MEASURE the real cliff on testnet (binary-search simulate) and set with margin —
    // this default is conservative. Exceeding it → OFFERING_TOO_MANY_BIDS (submit) / terminal (settle belt).
    maxBidsPerOffering: parseInt(
      process.env.OFFERING_MAX_BIDS_PER_OFFERING ?? String(OFFERING_MAX_BIDS_DEFAULT),
      10,
    ),
    // A row wedged in `subscribed` past this (no live settle job — crash between the settle commit and the
    // enqueue) is re-driven by the stale-subscribed reconcile sweep. Must exceed the worst-case settlement
    // wall-clock: TWO serialized on-chain txs (close_offering + close_and_settle), each a full poll cycle,
    // plus multi-offering backlog behind the shared account lock.
    settleGraceMs: parseInt(process.env.OFFERING_SETTLE_GRACE_MS ?? '300000', 10),
    // Approval quorum: the roster ("3"), an O(1) membership set, the threshold ("2"), and expiry window.
    signers: signers as readonly string[],
    signerSet: new Set(signers) as ReadonlySet<string>,
    threshold,
    ttlDays: parseInt(process.env.OFFERING_APPROVAL_TTL_DAYS ?? '7', 10),
  };
  // The signing seed is attached NON-ENUMERABLE so it's accessible to the signer (`cfg.adminSecret`)
  // but excluded from JSON.stringify / util.inspect / spread / Object.keys — logging/DI serialization
  // can't leak it.
  Object.defineProperty(cfg, 'adminSecret', { value: adminSecret, enumerable: false });
  return cfg as typeof cfg & { adminSecret: string };
});

export type OfferingEscrowConfig = ReturnType<typeof offeringEscrowConfig>;
