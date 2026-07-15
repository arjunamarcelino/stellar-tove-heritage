import 'server-only';

import { z } from 'zod/v4';
import {
  postJson,
  getJson,
  extractBackendCode,
  extractBackendMessage,
  statusFallbackCode,
} from '@/lib/services/http';
import { EXPORT_MESSAGES } from '@/lib/wallet/exportMessages';
import type {
  ExportBeginResult,
  ExportSubmitResult,
  ExportStatusResult,
  SignedExportItem,
  WalletExportErrorCode,
  TokenKind,
  ExportState,
  ExportItemStatus,
} from '@/lib/types/api';

// Enum tuples shared by the schemas, `satisfies`-guarded against the canonical unions in api.ts so a
// drift between a schema and its type fails to compile (todo 073).
const TOKEN_KINDS = ['usdc', 'fraction'] as const satisfies readonly TokenKind[];
const EXPORT_STATES = [
  'none',
  'pending',
  'submitting',
  'confirmed',
  'failed',
] as const satisfies readonly ExportState[];
const ITEM_STATUSES = [
  'pending',
  'submitted',
  'confirmed',
  'failed',
] as const satisfies readonly ExportItemStatus[];

// Export mutations + reconciliation read (TOV-40 confirmed contract). Export is N single-token
// transfers, each signed with its own per-item WebAuthn assertion; the server holds the txs and
// correlates by itemId at submit. No client-held tx, no client idempotency key.

const BEGIN_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 10_000;

// Which error codes the backend can send as an `errorCode` (passed through verbatim); the rest are
// client/HTTP-fallback-only. This is a Record (not a Set) so adding a WalletExportErrorCode forces a
// classification here at compile time — no silent drift where a new backend code falls through to a
// generic HTTP-status fallback on an irreversible money path (todo 063).
const IS_BACKEND_CODE: Record<WalletExportErrorCode, boolean> = {
  VALIDATION_FAILED: true,
  RECIPIENT_NOT_WHITELISTED: true,
  EXPORT_NOT_AVAILABLE: true,
  ALREADY_EXPORTED: true,
  WALLET_NOT_FOUND: true,
  EXPORT_NOT_FOUND: true,
  TRANSFER_SIGNATURE_INVALID: true,
  TRANSFER_EXPIRED: true,
  TRANSFER_SIMULATION_FAILED: true,
  TRANSFER_FAILED: true,
  TRANSFER_UNAVAILABLE: true,
  RATE_LIMITED: true,
  PASSKEY_FAILED: false, // client signing ceremony only
  SESSION_EXPIRED: false, // HTTP 401 fallback
  SERVER_ERROR: false, // HTTP fallback
  NETWORK_ERROR: false, // status-0 fallback
};

function isBackendCode(code: string): code is WalletExportErrorCode {
  return (
    Object.prototype.hasOwnProperty.call(IS_BACKEND_CODE, code) &&
    IS_BACKEND_CODE[code as WalletExportErrorCode]
  );
}

// Codes whose backend message is written for end users and safe to surface verbatim. For every other
// code — especially the settlement/transfer failures — we use curated copy so raw backend diagnostics
// (Soroban simulation/RPC text, internal addresses, ledger internals) can't leak into the UI of an
// irreversible money flow (todo 065).
const SAFE_PASSTHROUGH_CODES = new Set<WalletExportErrorCode>([
  'VALIDATION_FAILED',
  'RECIPIENT_NOT_WHITELISTED',
]);

function mapError(status: number, data: unknown): { code: WalletExportErrorCode; message: string } {
  const backendCode = extractBackendCode(data);
  const code = backendCode && isBackendCode(backendCode) ? backendCode : statusFallbackCode(status);
  const message = SAFE_PASSTHROUGH_CODES.has(code)
    ? extractBackendMessage(data, EXPORT_MESSAGES[code])
    : EXPORT_MESSAGES[code];
  return { code, message };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

const exportItemSchema = z.object({
  itemId: z.string(),
  tokenContract: z.string(),
  tokenKind: z.enum(TOKEN_KINDS),
  // Money: a scaled-i128 integer string. Constrained to digits so a malformed amount fails here
  // rather than mis-rendering on the irreversible confirm screen (todo 062).
  amountScaled: z.string().regex(/^\d+$/, 'amountScaled must be a non-negative integer string'),
  decimals: z.number().int().min(0).max(38),
  assetCode: z.string(),
  displayName: z.string(),
  challenge: z.string(),
  expiresAtLedger: z.number().int(),
});

const beginSchema = z.object({
  exportId: z.string(),
  targetAddress: z.string(),
  credentialId: z.string(),
  transports: z.string().nullable(),
  rpId: z.string(),
  items: z.array(exportItemSchema),
});

// submit only needs to confirm the accepted state; per-item detail is read from the status endpoint
// during reconcile, so the submit body's item array is intentionally not modeled here (todo 072).
const submitSchema = z.object({
  state: z.enum(EXPORT_STATES),
});

const statusSchema = z.object({
  exportId: z.string().nullable(),
  state: z.enum(EXPORT_STATES),
  selfCustodyAddress: z.string().optional(),
  items: z.array(
    z.object({
      tokenContract: z.string(),
      tokenKind: z.enum(TOKEN_KINDS),
      status: z.enum(ITEM_STATUSES),
      txHash: z.string().optional(),
    }),
  ),
});

export async function exportBegin(
  accessToken: string,
  walletId: string,
  targetAddress: string,
): Promise<ExportBeginResult> {
  const outcome = await postJson(
    `/v1/me/wallets/${walletId}/export`,
    { targetAddress },
    { timeoutMs: BEGIN_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = beginSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: EXPORT_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', data: parsed.data };
}

export async function exportSubmit(
  accessToken: string,
  walletId: string,
  exportId: string,
  items: SignedExportItem[],
): Promise<ExportSubmitResult> {
  const outcome = await postJson(
    `/v1/me/wallets/${walletId}/export/submit`,
    { exportId, items },
    { timeoutMs: SUBMIT_TIMEOUT_MS, headers: authHeaders(accessToken) },
  );

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = submitSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: EXPORT_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', data: parsed.data };
}

export async function exportStatus(
  accessToken: string,
  walletId: string,
): Promise<ExportStatusResult> {
  const outcome = await getJson(`/v1/me/wallets/${walletId}/export/status`, {
    timeoutMs: STATUS_TIMEOUT_MS,
    headers: authHeaders(accessToken),
  });

  if (!outcome.ok) {
    return { status: 'error', ...mapError(outcome.status, outcome.data) };
  }

  const parsed = statusSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: EXPORT_MESSAGES.SERVER_ERROR };
  }

  return { status: 'success', data: parsed.data };
}
