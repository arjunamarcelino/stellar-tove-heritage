import { registerAs } from '@nestjs/config';

/**
 * Stellar SEP-10 web-auth config. The signing secret is validated as required
 * (Joi) so the app fails fast if it is missing; never log or expose it. Network
 * passphrase / domains are config-pinned (never derived from client input).
 */
export const sep10Config = registerAs('sep10', () => ({
  serverSigningSecret: process.env.SEP10_SERVER_SIGNING_SECRET ?? '',
  homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'tove.io',
  webAuthDomain: process.env.SEP10_WEB_AUTH_DOMAIN ?? 'auth.tove.io',
  networkPassphrase: process.env.SEP10_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  // Challenge lifetime (seconds). Also the max age of an auth_challenges row.
  challengeTimeout: parseInt(process.env.SEP10_CHALLENGE_TIMEOUT ?? '300', 10),
  // Max outstanding (unconsumed, unexpired) challenges per pubkey (anti-abuse).
  maxOutstandingChallenges: parseInt(process.env.SEP10_MAX_OUTSTANDING ?? '5', 10),
}));

export type Sep10Config = ReturnType<typeof sep10Config>;
