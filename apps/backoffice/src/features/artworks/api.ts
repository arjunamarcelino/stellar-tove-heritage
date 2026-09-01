import { api } from '@/lib/api-client';
import { buildQueryString } from '@/lib/url-params';
import type { ArtworkListParams } from '@/types/api';

import {
  artworkDetailSchema,
  fractionalizationStatusSchema,
  paginatedArtworksSchema,
  type ArtworkDetail,
  type FractionalizeFormData,
  type FractionalizationStatus,
  type PaginatedArtworks,
} from './schemas';

export async function getArtworks(params?: ArtworkListParams): Promise<PaginatedArtworks> {
  const { status, ...pagination } = params ?? {};
  const data = await api.get(`/api/artworks${buildQueryString(pagination, { status })}`);
  return paginatedArtworksSchema.parse(data);
}

export async function getArtwork(id: string): Promise<ArtworkDetail> {
  const data = await api.get(`/api/artworks/${id}`);
  return artworkDetailSchema.parse(data);
}

export async function getFractionalizationStatus(id: string): Promise<FractionalizationStatus> {
  const data = await api.get(`/api/artworks/${id}/fractionalization`);
  return fractionalizationStatusSchema.parse(data);
}

export async function fractionalizeArtwork(
  id: string,
  data: FractionalizeFormData,
  idempotencyKey: string,
): Promise<FractionalizationStatus> {
  const res = await api.post(`/api/artworks/${id}/fractionalize`, data, { idempotencyKey });
  return fractionalizationStatusSchema.parse(res);
}
