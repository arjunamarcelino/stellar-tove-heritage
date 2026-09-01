import type { PaginationParams } from '@/types/api';

export function buildQueryString(
  params?: PaginationParams,
  filters?: Record<string, string | undefined>,
): string {
  if (!params && !filters) return '';

  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.order) searchParams.set('order', params.order);
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value != null) searchParams.set(key, value);
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
