'use client';

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  WebAuthnError,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticatorTransportFuture,
  PasskeyRegisterResult,
  PasskeyAssertionResult,
  PasskeySupport,
} from '@/lib/types/api';

const KNOWN_TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

// Assemble a WebAuthn assertion request from the primitives a backend returns per item (challenge +
// credential id/transports/rpId) — the export backend sends these rather than a pre-built options
// object. Kept here (not in the orchestration hook) so WebAuthn shape logic stays in lib/webauthn/.
// The cast is scoped to the single `transports` field so the rest of the literal stays type-checked;
// an unrecognized transport token is dropped (omitting transports is valid — the browser then allows
// any transport) rather than passed through unvalidated.
export function buildAssertionOptions(params: {
  challenge: string;
  credentialId: string;
  rpId: string;
  transports: string | null;
  timeoutMs?: number;
}): PublicKeyCredentialRequestOptionsJSON {
  const transports =
    params.transports && (KNOWN_TRANSPORTS as readonly string[]).includes(params.transports)
      ? [params.transports as AuthenticatorTransportFuture]
      : undefined;

  return {
    challenge: params.challenge,
    rpId: params.rpId,
    timeout: params.timeoutMs,
    userVerification: 'required',
    allowCredentials: [{ id: params.credentialId, type: 'public-key', transports }],
  };
}

// Runs the WebAuthn registration ceremony. Never throws — always resolves a discriminated result.
// `cancelled` (user dismissed / timed out) is deliberately neither success nor error; the hook
// turns it into a friendly, retryable PASSKEY_CANCELLED state.
export async function startPasskeyRegistration(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<PasskeyRegisterResult> {
  try {
    const response = await startRegistration({ optionsJSON });
    return { status: 'success', response };
  } catch (err) {
    return mapRegistrationError(err);
  }
}

// Runs the WebAuthn assertion (authentication) ceremony for the export signing flow. Never throws —
// always resolves a discriminated result, with `cancelled` (dismiss / timeout / no matching
// credential — indistinguishable per the WebAuthn spec) kept distinct from a real error.
export async function startPasskeyAssertion(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<PasskeyAssertionResult> {
  try {
    const response = await startAuthentication({ optionsJSON });
    return { status: 'success', response };
  } catch (err) {
    if (isWebAuthnCancel(err)) return { status: 'cancelled' };
    return {
      status: 'error',
      code: 'PASSKEY_FAILED',
      message:
        err instanceof WebAuthnError && err.message ? err.message : 'Passkey signature failed.',
    };
  }
}

// Shared two-level cancel narrowing (plan B1) for both ceremonies: WebAuthnError.code is a closed
// union, but a user dismiss/timeout arrives as a NotAllowedError DOMException — either on `err.cause`
// under ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY, or raw (unwrapped).
function isWebAuthnCancel(err: unknown): boolean {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_CEREMONY_ABORTED') return true;
    return (
      err.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' &&
      err.cause instanceof DOMException &&
      err.cause.name === 'NotAllowedError'
    );
  }
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

function mapRegistrationError(err: unknown): Exclude<PasskeyRegisterResult, { status: 'success' }> {
  if (isWebAuthnCancel(err)) return { status: 'cancelled' };

  // Registration-only: the authenticator already holds a credential for this user.
  if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return {
      status: 'error',
      code: 'PASSKEY_ALREADY_BOUND',
      message: 'This passkey is already registered on this device.',
    };
  }

  return {
    status: 'error',
    code: 'PASSKEY_FAILED',
    message:
      err instanceof WebAuthnError && err.message ? err.message : 'Passkey registration failed.',
  };
}

type ClientCapabilities = Record<string, boolean | undefined>;

// Feature-detects WebAuthn + a platform authenticator. Prefers the native
// getClientCapabilities() (avoids the iOS WKWebView isUVPAA bug, plan E1), falling back to the
// library's platformAuthenticatorIsAvailable(). Never throws.
export async function detectPasskeySupport(): Promise<PasskeySupport> {
  try {
    if (!browserSupportsWebAuthn()) return { supported: false };

    const PKC = typeof window !== 'undefined' ? window.PublicKeyCredential : undefined;
    const getCaps = (
      PKC as { getClientCapabilities?: () => Promise<ClientCapabilities> } | undefined
    )?.getClientCapabilities;

    if (typeof getCaps === 'function') {
      const caps = await getCaps.call(PKC);
      const platform = caps.passkeyPlatformAuthenticator ?? caps.userVerifyingPlatformAuthenticator;
      if (typeof platform === 'boolean') return { supported: platform };
    }

    return { supported: await platformAuthenticatorIsAvailable() };
  } catch {
    return { supported: false };
  }
}
