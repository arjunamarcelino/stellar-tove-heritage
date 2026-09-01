import 'server-only';

import { z } from 'zod/v4';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  PasskeyBeginResult,
  PasskeyFinishServiceResult,
  PasskeyServiceErrorCode,
  PasskeyMode,
  FinishPasskeyInput,
} from '@/lib/types/api';
import { postJson, extractBackendCode, extractBackendMessage } from '@/lib/services/http';

// Unified email-first passkey contract (see the FE brief). One email field, two round-trips:
// begin decides login-vs-signup and returns the matching WebAuthn options; finish verifies the
// ceremony and returns tokens. Error bodies share { statusCode, error, message, errorCode } — we
// branch on `errorCode`, falling back to HTTP status.

// begin issues a challenge (fast); finish may deploy a contract on-chain on signup (a few seconds,
// up to ~20s) — login does no on-chain work.
const BEGIN_TIMEOUT_MS = 10_000;
const FINISH_TIMEOUT_MS = 35_000;

// finish 200 = { accessToken, refreshToken, contractAddress } (same shape for login and signup).
// The BFF sets its own httpOnly cookies from the tokens, so refreshToken is required here even
// though the backend DTO marks it optional.
const finishResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  contractAddress: z.string(),
});

const DEFAULT_MESSAGES: Record<PasskeyServiceErrorCode, string> = {
  VALIDATION_ERROR: 'Please check your details and try again.',
  EMAIL_CONFLICT: 'That email is already registered with a different sign-in method.',
  PASSKEY_ALREADY_BOUND: 'This passkey is already linked to another account.',
  AUTH_CHALLENGE_EXPIRED: 'Your registration session expired. Please start over.',
  PASSKEY_VERIFICATION_FAILED: "We couldn't verify your passkey. Please start over.",
  WALLET_DEPLOY_FAILED: "We couldn't finish creating your wallet. Please try again.",
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SERVER_ERROR: 'Something went wrong. Please try again.',
  NETWORK_ERROR: 'Unable to reach the server. Check your connection and try again.',
};

// Maps the backend `errorCode` to our client taxonomy. Returns undefined when there's no explicit
// code, so the caller can fall back to HTTP status.
function mapBackendErrorCode(errorCode: string | undefined): PasskeyServiceErrorCode | undefined {
  switch (errorCode) {
    case 'VALIDATION_FAILED':
      return 'VALIDATION_ERROR';
    case 'AUTH_EMAIL_CONFLICT':
      return 'EMAIL_CONFLICT';
    case 'PASSKEY_ALREADY_BOUND':
      return 'PASSKEY_ALREADY_BOUND';
    case 'AUTH_CHALLENGE_EXPIRED':
    case 'AUTH_CHALLENGE_NOT_FOUND':
    case 'AUTH_CHALLENGE_ALREADY_USED':
      return 'AUTH_CHALLENGE_EXPIRED';
    case 'AUTH_PASSKEY_VERIFICATION_FAILED':
      return 'PASSKEY_VERIFICATION_FAILED';
    case 'WALLET_DEPLOY_FAILED':
      return 'WALLET_DEPLOY_FAILED';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    default:
      return undefined;
  }
}

function mapServiceError(
  status: number,
  data: unknown,
  fallbackConflict: PasskeyServiceErrorCode,
): { code: PasskeyServiceErrorCode; message: string } {
  let code = mapBackendErrorCode(extractBackendCode(data));
  if (!code) {
    if (status === 0) code = 'NETWORK_ERROR';
    else if (status === 409) code = fallbackConflict;
    else if (status === 429) code = 'RATE_LIMITED';
    else if (status === 400) code = 'VALIDATION_ERROR';
    else if (status === 503) code = 'WALLET_DEPLOY_FAILED';
    else code = 'SERVER_ERROR';
  }
  const fallback = DEFAULT_MESSAGES[code];
  // status 0 = no response reached; there is no backend message to surface.
  return { code, message: status === 0 ? fallback : extractBackendMessage(data, fallback) };
}

// The begin body is { mode, options }. Options is passed verbatim into the browser ceremony —
// preserve the object (never strip/re-validate); accept a bare-options envelope too, defensively.
// Both creation (signup) and request (login) options carry a string `challenge`, so one guard fits.
type PasskeyOptions =
  | PublicKeyCredentialCreationOptionsJSON
  | PublicKeyCredentialRequestOptionsJSON;

function extractOptions(data: unknown): PasskeyOptions | null {
  if (!data || typeof data !== 'object') return null;
  const wrapped = (data as { options?: unknown }).options;
  const opts = wrapped ?? data;
  if (
    opts &&
    typeof opts === 'object' &&
    typeof (opts as { challenge?: unknown }).challenge === 'string'
  ) {
    return opts as PasskeyOptions;
  }
  return null;
}

function extractMode(data: unknown): PasskeyMode | null {
  const mode = (data as { mode?: unknown })?.mode;
  return mode === 'login' || mode === 'signup' ? mode : null;
}

export async function begin(email: string): Promise<PasskeyBeginResult> {
  const outcome = await postJson(
    '/v1/auth/passkey/begin',
    { email },
    { timeoutMs: BEGIN_TIMEOUT_MS },
  );
  if (!outcome.ok) {
    return { status: 'error', ...mapServiceError(outcome.status, outcome.data, 'EMAIL_CONFLICT') };
  }
  const mode = extractMode(outcome.data);
  const options = extractOptions(outcome.data);
  if (!mode || !options) {
    return {
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Received invalid options from the server.',
    };
  }
  // Narrow the options type to the mode so the client picks the correct ceremony.
  return mode === 'login'
    ? { status: 'success', mode, options: options as PublicKeyCredentialRequestOptionsJSON }
    : { status: 'success', mode, options: options as PublicKeyCredentialCreationOptionsJSON };
}

export async function finish(input: FinishPasskeyInput): Promise<PasskeyFinishServiceResult> {
  // Send exactly one response field, matching the mode from begin (assertion for login, attestation
  // for signup). PASSKEY_ALREADY_BOUND is the sensible 409 fallback for the signup path.
  const body =
    input.mode === 'login'
      ? { email: input.email, assertionResponse: input.assertionResponse }
      : { email: input.email, attestationResponse: input.attestationResponse };
  const outcome = await postJson('/v1/auth/passkey/finish', body, { timeoutMs: FINISH_TIMEOUT_MS });
  if (!outcome.ok) {
    return {
      status: 'error',
      ...mapServiceError(outcome.status, outcome.data, 'PASSKEY_ALREADY_BOUND'),
    };
  }
  const parsed = finishResponseSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Received an invalid registration response from the server.',
    };
  }
  return {
    status: 'success',
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    contractAddress: parsed.data.contractAddress,
  };
}
