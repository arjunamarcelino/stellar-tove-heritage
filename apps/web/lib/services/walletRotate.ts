import 'server-only';

import { z } from 'zod/v4';
import {
  postJson,
  getJson,
  deleteJson,
  extractBackendCode,
  extractBackendMessage,
  statusFallbackCode,
} from '@/lib/services/http';
import { ROTATION_MESSAGES } from '@/lib/wallet/rotationMessages';
import type { Equals } from '@/lib/types/typeUtils';
import type {
  RotationInitiateResult,
  RotationSubmitResult,
  RotationStatusResult,
  RotationCancelResult,
  SignedRotationItem,
  WalletRotationErrorCode,
  RotationLifecycle,
  RotationState,
  RotationItemStatus,
} from '@/lib/types/api';

// Wallet-rotation holdings-transfer service (TOV-48 / FR-01.12). Clones the walletExport doctrine:
// per-item WebAuthn assertions, the server holds the txs and correlates by itemId, NO client-held tx and
// NO client idempotency key (server nonce + one-way latch + reconcile-via-status). Only FractionTokens
// move. `server-only`. See docs/plans/2026-08-27-feat-wallet-rotation-flow-plan.md.

const INITIATE_TIMEOUT_MS = 20_000; // initiate re-reads the on-chain catalog — give it headroom
const SUBMIT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 10_000;
const CANCEL_TIMEOUT_MS = 10_000;

// Enum tuples for the schemas, `satisfies`-guarded against the canonical unions AND asserted complete via
// Equals (walletExport's tuples only check the ⊆ direction — a dropped member would silently narrow the
// parser; the reverse Equals here closes that gap).
const ROTATION_LIFECYCLES = [
  'pending',
  'submitting',
  'completed',
] as const satisfies readonly RotationLifecycle[];
const ROTATION_STATES = [
  'none',
  'pending',
  'submitting',
  'confirmed',
  'failed',
] as const satisfies readonly RotationState[];
const ROTATION_ITEM_STATUSES = [
  'pending',
  'submitted',
  'confirmed',
  'failed',
] as const satisfies readonly RotationItemStatus[];

const _assertLifecycles: Equals<(typeof ROTATION_LIFECYCLES)[number], RotationLifecycle> = true;
const _assertStates: Equals<(typeof ROTATION_STATES)[number], RotationState> = true;
const _assertItemStatuses: Equals<(typeof ROTATION_ITEM_STATUSES)[number], RotationItemStatus> =
  true;
void _assertLifecycles;
void _assertStates;
void _assertItemStatuses;

// Which codes the backend can send as an `errorCode` (passed through verbatim as the code); the rest are
// client/HTTP-status fallbacks. A Record (not a Set) so adding a WalletRotationErrorCode forces a
// classification here at compile time — no silent drift to a generic fallback on an irreversible path.
const IS_BACKEND_CODE: Record<WalletRotationErrorCode, boolean> = {
  VALIDATION_FAILED: true,
  WALLET_NOT_FOUND: true,
  ROTATION_SOURCE_INVALID: true,
  ALREADY_EXPORTED: true,
  ROTATION_DESTINATION_INVALID: true,
  ROTATION_DESTINATION_NOT_PRIMARY: true,
  ROTATION_CONFLICT: true,
  ROTATION_NOTHING_TO_TRANSFER: true,
  ROTATION_BLOCKED_BY_LOCKUP: true,
  RECIPIENT_NOT_WHITELISTED: true,
  ROTATION_NOT_FOUND: true,
  ROTATION_CANNOT_CANCEL: true,
  RATE_LIMITED: true,
  PASSKEY_FAILED: false, // client signing ceremony only
  SESSION_EXPIRED: false, // HTTP 401 fallback
  SERVER_ERROR: false, // HTTP fallback
  NETWORK_ERROR: false, // status-0 fallback
};

function isBackendCode(code: string): code is WalletRotationErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_BACKEND_CODE, code) &&
    IS_BACKEND_CODE[code as WalletRotationErrorCode]
  );
}

// Codes whose backend message is written for end users and safe to surface verbatim. Everything else —
// especially the settlement/lockup codes — uses curated copy so raw backend diagnostics can't leak into
// an irreversible money flow. Identical to export's allowlist; ROTATION_BLOCKED_BY_LOCKUP is deliberately
// NOT here (its copy is composed from the machine-readable lockupExpiresAt).
const SAFE_PASSTHROUGH_CODES = new Set<WalletRotationErrorCode>([
  'VALIDATION_FAILED',
  'RECIPIENT_NOT_WHITELISTED',
]);

function mapError(
  status: number,
  data: unknown,
): { code: WalletRotationErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code = backendCode && isBackendCode(backendCode) ? backendCode : statusFallbackCode(status);
  const message = SAFE_PASSTHROUGH_CODES.has(code)
    ? extractBackendMessage(data, ROTATION_MESSAGES[code])
    : ROTATION_MESSAGES[code];
  return { code, message };
}

// The ROTATION_BLOCKED_BY_LOCKUP 422 carries an ISO-8601 `lockupExpiresAt` (TOV-33 Q1) so the review step
// can name the unlock date. Read defensively — a non-string is treated as absent.
function extractLockupExpiresAt(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'lockupExpiresAt' in data) {
    const value = (data as { lockupExpiresAt?: unknown }).lockupExpiresAt;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

const rotationItemSchema = z.object({
  itemId: z.string(),
  tokenContract: z.string(),
  // Money: a scaled-i128 integer string. Constrained to digits so a malformed amount fails here rather
  // than mis-rendering on the irreversible confirm screen.
  amountScaled: z.string().regex(/^\d+$/, 'amountScaled must be a non-negative integer string'),
  decimals: z.number().int().min(0).max(38),
  displayName: z.string().optional(),
  challenge: z.string(),
  expiresAtLedger: z.number().int(),
  credentialId: z.string(),
  rpId: z.string(),
  transports: z.string().nullable(),
});

const initiateSchema = z.object({
  rotationId: z.string(),
  status: z.enum(ROTATION_LIFECYCLES),
  destinationWalletId: z.string(),
  items: z.array(rotationItemSchema),
});

// Per-item settlement detail (submit + status). errorCode stays a BARE STRING at the boundary — an
// unlisted backend TRANSFER_* must not fail the whole parse and lose the failed-item signal; it is
// classified after parse (unknown → terminal). txHash/ledger are nullish (a recovered `confirmed` may
// carry null).
const itemStatusSchema = z.object({
  itemId: z.string(),
  tokenContract: z.string(),
  amountScaled: z.string().regex(/^\d+$/, 'amountScaled must be a non-negative integer string'),
  status: z.enum(ROTATION_ITEM_STATUSES),
  txHash: z.string().nullish(),
  ledger: z.number().int().nullish(),
  errorCode: z.string().optional(),
});

const submitSchema = z.object({
  rotationId: z.string(),
  status: z.enum(ROTATION_LIFECYCLES),
  items: z.array(itemStatusSchema),
});

const statusSchema = z.object({
  rotationId: z.string(),
  state: z.enum(ROTATION_STATES),
  // Echoed for an active rotation; absent/empty on `state: 'none'` (nullish→'' so the none case parses).
  destinationWalletId: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  destinationAddress: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  items: z.array(itemStatusSchema),
});

const cancelSchema = z.object({ canceledId: z.string() });

export async function rotateInitiate(
  accessToken: string,
  sourceWalletId: string,
  destinationWalletId: string,
): Promise<RotationInitiateResult> {
  const outcome = await postJson(
    `/v1/me/wallets/${encodeURIComponent(sourceWalletId)}/rotate-transfer`,
    { destinationWalletId },
    { timeoutMs: INITIATE_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    const { code, message } = mapError(outcome.status, outcome.data);
    return code === 'ROTATION_BLOCKED_BY_LOCKUP'
      ? { status: 'error', code, message, lockupExpiresAt: extractLockupExpiresAt(outcome.data) }
      : { status: 'error', code, message };
  }

  const parsed = initiateSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ROTATION_MESSAGES.SERVER_ERROR };
  }
  return { status: 'success', data: parsed.data };
}

export async function rotateSubmit(
  accessToken: string,
  sourceWalletId: string,
  items: SignedRotationItem[],
): Promise<RotationSubmitResult> {
  const outcome = await postJson(
    `/v1/me/wallets/${encodeURIComponent(sourceWalletId)}/rotate-transfer/submit`,
    { items },
    { timeoutMs: SUBMIT_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = submitSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ROTATION_MESSAGES.SERVER_ERROR };
  }
  return { status: 'success', data: parsed.data };
}

export async function rotateStatus(
  accessToken: string,
  sourceWalletId: string,
): Promise<RotationStatusResult> {
  const outcome = await getJson(
    `/v1/me/wallets/${encodeURIComponent(sourceWalletId)}/rotate-transfer/status`,
    { timeoutMs: STATUS_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = statusSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ROTATION_MESSAGES.SERVER_ERROR };
  }
  return { status: 'success', data: parsed.data };
}

export async function rotateCancel(
  accessToken: string,
  sourceWalletId: string,
): Promise<RotationCancelResult> {
  const outcome = await deleteJson(
    `/v1/me/wallets/${encodeURIComponent(sourceWalletId)}/rotate-transfer`,
    { timeoutMs: CANCEL_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = cancelSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: ROTATION_MESSAGES.SERVER_ERROR };
  }
  return { status: 'success', canceledId: parsed.data.canceledId };
}
