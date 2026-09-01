/**
 * Canonical artwork lifecycle states (TOV-233 / TOV-240). Single source of truth for BOTH the runtime
 * tuple (fed to class-validator `@IsIn`) AND the derived `ArtworkStatus` type. Homed in a standalone
 * constant — not the entity — so DTOs/validators can import it without pulling the TypeORM entity
 * (mirrors the `@common/enums/kyc-status.enum` "import down" precedent and avoids an import cycle).
 *
 * `verified` is the only fractionalizable state.
 */
export const ARTWORK_STATUSES = ['verified', 'published', 'fractionalizing', 'fractionalized'] as const;

export type ArtworkStatus = (typeof ARTWORK_STATUSES)[number];
