import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { OfferingListParams } from '@/types/api';

import {
  approveResponseSchema,
  offeringDetailSchema,
  paginatedOfferingsSchema,
  type ApproveResponse,
  type OfferingDetail,
  type PaginatedOfferings,
} from './schemas';

export async function getOfferings(params: OfferingListParams = {}): Promise<PaginatedOfferings> {
  const { status, artworkId, ...pagination } = params;
  const data = await api.get(
    `/api/offerings${buildQueryString(pagination, { status, artworkId })}`,
  );
  return paginatedOfferingsSchema.parse(data);
}

export async function getOffering(id: string): Promise<OfferingDetail> {
  const data = await api.get(`/api/offerings/${id}`);
  return offeringDetailSchema.parse(data);
}

/**
 * Record the calling admin's approval (empty body). The caller OWNS the idempotency-key lifecycle: a
 * FRESH key per user-initiated attempt (retry-after-fail / re-approve-after-expiry both need a new
 * key); the same in-flight key is reused only for a same-submit retry → IDEMPOTENCY_KEY_IN_FLIGHT.
 */
export async function approveOffering(id: string, idempotencyKey: string): Promise<ApproveResponse> {
  const res = await api.post(`/api/offerings/${id}/approve`, {}, { idempotencyKey });
  return approveResponseSchema.parse(res);
}
