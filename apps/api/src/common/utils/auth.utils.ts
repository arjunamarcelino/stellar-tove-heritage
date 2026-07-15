import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Pre-computed bcrypt hash used for timing-attack mitigation.
 * When a login attempt targets a non-existent or inactive user, we still run
 * bcrypt.compare against this dummy hash so the response time is indistinguishable
 * from a valid-user lookup. This prevents attackers from enumerating valid emails
 * by measuring response latency.
 */
export const TIMING_SAFE_DUMMY_HASH =
  '$2b$12$LJ3m4ys3Lf.MpGNXHOY9a.5F6DzWGd6F3E.GnEsS3FLzT3lXz0gKu';

const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a JWT-style duration string (e.g. '7d', '15m', '1h') into milliseconds.
 * Returns 7 days in ms as fallback for unparseable values.
 */
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 86_400_000;
  return parseInt(match[1], 10) * DURATION_MULTIPLIERS[match[2]];
}

export function hashRefreshToken(token: string, hmacSecret: string): string {
  return createHmac('sha256', hmacSecret).update(token).digest('hex');
}

export function verifyRefreshToken(
  token: string,
  storedHash: string,
  hmacSecret: string,
): boolean {
  const computed = hashRefreshToken(token, hmacSecret);
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}
