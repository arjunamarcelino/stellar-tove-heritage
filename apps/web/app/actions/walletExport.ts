'use server';

import { cookies } from 'next/headers';
import { COOKIE_KEYS } from '@/lib/constants';
import { publicKeySchema, signedExportItemsSchema } from '@/lib/wallet/schemas';
import { exportBegin, exportSubmit, exportStatus } from '@/lib/services/walletExport';
import type {
  ExportBeginResult,
  ExportSubmitResult,
  ExportStatusResult,
  SignedExportItem,
} from '@/lib/types/api';

// Thin server actions for the export flow: read the Bearer token from the httpOnly cookie (never
// trust a client-passed token — Next 16 Server-Function guidance), validate input, delegate to the
// service. Results carry no secrets, so they are returned to the client as-is.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: 'Your session expired. Please sign in again.',
};

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

// Requests the export: validates the target address is a canonical Stellar address, then delegates.
// The self-address and allowlist checks are authoritative on the backend (VALIDATION_FAILED /
// RECIPIENT_NOT_WHITELISTED); the client also pre-checks self-address for instant feedback.
export async function exportBeginAction(
  walletId: string,
  targetAddress: string,
): Promise<ExportBeginResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  const parsed = publicKeySchema.safeParse(targetAddress);
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'Enter a valid Stellar address.',
    };
  }

  return exportBegin(token, walletId, parsed.data);
}

// Submits the per-item signed assertions. Validates their shape (defense-in-depth) but forwards the
// ORIGINAL objects so no fields are stripped before backend verification.
export async function exportSubmitAction(
  walletId: string,
  exportId: string,
  items: SignedExportItem[],
): Promise<ExportSubmitResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!signedExportItemsSchema.safeParse(items).success) {
    return { status: 'error', code: 'VALIDATION_FAILED', message: 'Invalid signed items.' };
  }

  return exportSubmit(token, walletId, exportId, items);
}

// Reconciliation read — polled from the hook after submit; stateless / cold-session safe.
export async function exportStatusAction(walletId: string): Promise<ExportStatusResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  return exportStatus(token, walletId);
}
