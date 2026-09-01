import type { ArtworkStatus } from '@modules/fractionalization/constants/artwork-status.constant';

/**
 * Default status filter for the admin artwork list (TOV-240) when no `status` query param is supplied:
 * the fractionalization-relevant states. This is a backoffice VIEW policy, not a domain property, so it
 * lives with its consumer rather than on the shared entity (a future public read model may differ).
 */
export const DEFAULT_ARTWORK_LIST_STATUSES: readonly ArtworkStatus[] = [
  'verified',
  'fractionalizing',
  'fractionalized',
];
