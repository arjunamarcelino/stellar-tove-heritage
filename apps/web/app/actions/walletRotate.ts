'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { COOKIE_KEYS } from '@/lib/constants';
import { signedRotationItemsSchema } from '@/lib/wallet/schemas';
import { ROTATION_MESSAGES } from '@/lib/wallet/rotationMessages';
import {
  rotateInitiate,
  rotateSubmit,
  rotateStatus,
  rotateCancel,
} from '@/lib/services/walletRotate';
import { getCurrentLedger } from '@/lib/stellar/ledger';
import type { Equals } from '@/lib/types/typeUtils';
import type {
  RotationInitiateResult,
  RotationSubmitResult,
  RotationStatusResult,
  RotationCancelResult,
  SignedRotationItem,
} from '@/lib/types/api';

// Thin server actions for the wallet-rotation flow (TOV-48 / FR-01.12): read the Bearer token from the
// httpOnly cookie (never trust a client-passed token — Next 16 Server-Function guidance), validate input,
// delegate to the service. Results carry no secrets, so they are returned to the client as-is.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: ROTATION_MESSAGES.SESSION_EXPIRED,
};

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

const walletIdSchema = z.uuid();

// The action forwards the ORIGINAL signed objects (no field stripping before backend crypto verify);
// assert the shape schema can't drift from SignedRotationItem so a looser schema can't silently pass a
// malformed body.
const _assertSignedShape: Equals<
  z.infer<typeof signedRotationItemsSchema>[number],
  SignedRotationItem
> = true;
void _assertSignedShape;

// Initiate the holdings transfer. Both ids come from our own wallet list, so the uuid checks are
// defense-in-depth: a malformed source can't match a real wallet (→ WALLET_NOT_FOUND), and a malformed
// destination is a client bug (→ ROTATION_DESTINATION_INVALID). Allowlist / primary / lockup are all
// authoritative on the backend.
export async function rotateInitiateAction(
  sourceWalletId: string,
  destinationWalletId: string,
): Promise<RotationInitiateResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(sourceWalletId).success) {
    return {
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: ROTATION_MESSAGES.WALLET_NOT_FOUND,
    };
  }
  if (!walletIdSchema.safeParse(destinationWalletId).success) {
    return {
      status: 'error',
      code: 'ROTATION_DESTINATION_INVALID',
      message: ROTATION_MESSAGES.ROTATION_DESTINATION_INVALID,
    };
  }

  return rotateInitiate(token, sourceWalletId, destinationWalletId);
}

// Submit the per-item signed assertions. Validates their shape (defense-in-depth) but forwards the
// ORIGINAL objects so no fields are stripped before backend verification.
export async function rotateSubmitAction(
  sourceWalletId: string,
  items: SignedRotationItem[],
): Promise<RotationSubmitResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(sourceWalletId).success) {
    return {
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: ROTATION_MESSAGES.WALLET_NOT_FOUND,
    };
  }
  if (!signedRotationItemsSchema.safeParse(items).success) {
    return {
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: ROTATION_MESSAGES.VALIDATION_FAILED,
    };
  }

  return rotateSubmit(token, sourceWalletId, items);
}

// Reconciliation read — polled from the hook to drive/resume progress; stateless / cold-session safe.
export async function rotateStatusAction(sourceWalletId: string): Promise<RotationStatusResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(sourceWalletId).success) {
    return {
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: ROTATION_MESSAGES.WALLET_NOT_FOUND,
    };
  }

  return rotateStatus(token, sourceWalletId);
}

// Cancel an abandoned rotation (only allowed when nothing is in-flight/confirmed — backend enforces).
export async function rotateCancelAction(sourceWalletId: string): Promise<RotationCancelResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(sourceWalletId).success) {
    return {
      status: 'error',
      code: 'ROTATION_NOT_FOUND',
      message: ROTATION_MESSAGES.ROTATION_NOT_FOUND,
    };
  }

  return rotateCancel(token, sourceWalletId);
}

// Current Stellar ledger height, so the client can skip signing a challenge that has already expired (a
// proactive freshness check that avoids burning a passkey ceremony on a stale challenge). Public Horizon
// read — no auth needed; fail-soft (null on any error, and the caller then signs anyway).
export async function getCurrentLedgerAction(): Promise<number | null> {
  return getCurrentLedger();
}
