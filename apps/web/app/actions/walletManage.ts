'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { COOKIE_KEYS } from '@/lib/constants';
import { publicKeySchema, signedXdrSchema } from '@/lib/wallet/schemas';
import {
  addWalletChallenge,
  addWallet,
  removeWallet,
  setPrimaryWallet,
} from '@/lib/services/walletManage';
import {
  ADD_WALLET_MESSAGES,
  REMOVE_WALLET_MESSAGES,
  SET_PRIMARY_WALLET_MESSAGES,
} from '@/lib/wallet/manageMessages';
import type {
  AddWalletChallengeResult,
  AddWalletResult,
  RemoveWalletResult,
  SetPrimaryWalletResult,
} from '@/lib/types/api';

// Thin server actions for the wallet-management flow (FR-01.03): read the Bearer token from the
// httpOnly cookie (never trust a client-passed token), validate input, delegate to the service.
// Results carry no secrets, so they are returned to the client as-is.

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: 'Your session expired. Please sign in again.',
};

async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

const walletIdSchema = z.uuid();
// Shape-only: the key is self-minted by the client's crypto.randomUUID() (always v4), so version
// gating adds no value — this just rejects a malformed value early.
const idempotencyKeySchema = z.uuid();

// Add step A: request a SEP-10 challenge for a Stellar public key the user controls.
export async function addWalletChallengeAction(
  publicKey: string,
): Promise<AddWalletChallengeResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!publicKeySchema.safeParse(publicKey).success) {
    return {
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: ADD_WALLET_MESSAGES.VALIDATION_FAILED,
    };
  }

  return addWalletChallenge(token, publicKey);
}

// Add step B: submit the client-signed challenge with a client-generated Idempotency-Key. Validates
// the signed-XDR shape and key shape (defense-in-depth) before delegating; forwards the token in the
// header via the service.
export async function addWalletAction(
  signedChallengeXdr: string,
  idempotencyKey: string,
): Promise<AddWalletResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (
    !signedXdrSchema.safeParse(signedChallengeXdr).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success
  ) {
    return {
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: ADD_WALLET_MESSAGES.VALIDATION_FAILED,
    };
  }

  return addWallet(token, signedChallengeXdr, idempotencyKey);
}

// Remove (soft-unbind) a wallet. The id comes from our own list, so the uuid check is defense-in-depth;
// a malformed id can't match a real wallet, so it maps to WALLET_NOT_FOUND (the panel treats that as
// "already removed → refresh").
export async function removeWalletAction(walletId: string): Promise<RemoveWalletResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(walletId).success) {
    return {
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: REMOVE_WALLET_MESSAGES.WALLET_NOT_FOUND,
    };
  }

  return removeWallet(token, walletId);
}

// Promote a wallet to primary. The id comes from our own list, so the uuid check is defense-in-depth;
// a malformed id can't match a real wallet, so it maps to WALLET_NOT_FOUND (the dialog resolves +
// refreshes, parity with removeWalletAction — never a dead-end VALIDATION_FAILED).
export async function setPrimaryWalletAction(walletId: string): Promise<SetPrimaryWalletResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  if (!walletIdSchema.safeParse(walletId).success) {
    return {
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: SET_PRIMARY_WALLET_MESSAGES.WALLET_NOT_FOUND,
    };
  }

  return setPrimaryWallet(token, walletId);
}
