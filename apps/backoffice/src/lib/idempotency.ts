/**
 * Shared idempotency-key format, used by BOTH the client (`api-client`, asserts before send) and the BFF
 * proxy (`api-proxy`, allow-lists before forwarding). Keeping one source of truth means the two ends can't
 * drift and silently drop the double-deploy guard. `crypto.randomUUID()` satisfies this pattern.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
