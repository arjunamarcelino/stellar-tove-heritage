import type { Base64URLString } from '@simplewebauthn/server';

// The COSE→raw-P256 decode now lives in the wallets aggregate (the stored credential is a wallets
// concern; keeping @simplewebauthn there means the relayer does not depend on @simplewebauthn — it
// does its own raw WebAuthn assertion verification manually). Re-exported here so the passkey
// registration flow's import path is unchanged.
export { decodeCoseToRawP256 } from '@modules/wallets/cose.helper';

/**
 * Extract the WebAuthn challenge the client signed, from clientDataJSON. Works for BOTH a
 * registration attestation and an authentication assertion (both carry `response.clientDataJSON`).
 * Throws on malformed input (the caller maps that to AUTH_PASSKEY_VERIFICATION_FAILED, not a 500).
 */
export function extractClientChallenge(response: {
  response: { clientDataJSON: Base64URLString };
}): string {
  const json = Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as { challenge?: unknown };
  if (typeof parsed.challenge !== 'string' || parsed.challenge.length === 0) {
    throw new Error('clientDataJSON is missing a challenge');
  }
  return parsed.challenge;
}
