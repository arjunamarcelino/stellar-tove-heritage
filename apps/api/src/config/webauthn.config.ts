import { registerAs } from '@nestjs/config';

/**
 * WebAuthn (embedded passkey) registration config. `rpId` and `origins` are
 * security-sensitive (they anchor origin/RP validation), so they have no real
 * factory default and are Joi-`required()` — the app fails fast if unset.
 * `WEBAUTHN_ORIGIN` is a comma-separated allowlist (apex/www/native).
 */
export const webauthnConfig = registerAs('webauthn', () => ({
  rpId: process.env.WEBAUTHN_RP_ID ?? '',
  rpName: process.env.WEBAUTHN_RP_NAME ?? 'Tove',
  origins: (process.env.WEBAUTHN_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Challenge lifetime (seconds); also the max age of a passkey_challenges row.
  challengeTimeout: parseInt(process.env.WEBAUTHN_CHALLENGE_TIMEOUT ?? '300', 10),
  // Max outstanding (unconsumed, unexpired) challenges per email (anti-abuse; evict-oldest).
  maxOutstandingChallenges: parseInt(process.env.WEBAUTHN_MAX_OUTSTANDING ?? '5', 10),
}));

export type WebauthnConfig = ReturnType<typeof webauthnConfig>;
