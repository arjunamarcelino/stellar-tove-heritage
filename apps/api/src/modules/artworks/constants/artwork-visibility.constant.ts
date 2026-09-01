import type { ArtworkStatus } from '@modules/fractionalization/constants/artwork-status.constant';

/**
 * The artwork statuses visible on the ANONYMOUS public surface (TOV-189, FR-08.01 / FR-03.08).
 * Single source of truth for the `WHERE status IN (...)` predicate used by BOTH the list and detail
 * reads, so they can never drift. `published` and the transient `fractionalizing` are intentionally
 * hidden from anonymous callers (a hidden/soft-deleted artwork returns 404, never revealing existence).
 *
 * `satisfies readonly ArtworkStatus[]` ties this subset to the canonical fractionalization vocabulary
 * at COMPILE time: renaming a canonical status breaks THIS build (drift guard), per the pr34/pr35
 * "guard over `as`-cast" convention.
 */
export const PUBLIC_VISIBLE_STATUSES = ['verified', 'fractionalized'] as const satisfies readonly ArtworkStatus[];

export type PublicArtworkStatus = (typeof PUBLIC_VISIBLE_STATUSES)[number];

/**
 * Runtime narrowing guard for a DB `status` string flowing out of the read repo. The visibility WHERE
 * clause already guarantees membership, so this only fires on schema drift — where it fails LOUD (→ 500)
 * rather than silently mis-typing. The single `as` here is the sanctioned one: it is gated by the
 * runtime `.includes` check (widened to `string[]`, required under strict mode).
 */
export function assertVisibleStatus(status: string): PublicArtworkStatus {
  if ((PUBLIC_VISIBLE_STATUSES as readonly string[]).includes(status)) {
    return status as PublicArtworkStatus;
  }
  throw new Error(`Unexpected artwork status escaped the public visibility filter: ${status}`);
}
