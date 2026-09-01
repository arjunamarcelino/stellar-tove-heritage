import { ApiError } from '@/types/api';

import { IDEMPOTENCY_KEY_PATTERN } from './idempotency';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const STATE_CHANGING_METHODS: HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

async function handleErrorResponse(response: Response): Promise<never> {
  let message = 'An unexpected error occurred';
  let code = 'UNKNOWN_ERROR';

  try {
    const errorData = await response.json();
    message = errorData.error?.message ?? errorData.message ?? message;
    code = errorData.error?.code ?? code;
  } catch {
    // response body wasn't JSON
  }

  throw new ApiError(message, response.status, code);
}

interface RequestOptions {
  /** Forwarded verbatim as the `Idempotency-Key` header for idempotent backend actions. */
  idempotencyKey?: string;
}

async function request<T>(
  method: HttpMethod,
  url: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  // SECURITY: set caller-supplied headers first, then let the reserved defaults
  // (Content-Type, X-CSRF-Protection) win — a caller must never be able to strip CSRF.
  const headers: Record<string, string> = {};
  if (options?.idempotencyKey) {
    // Fail loud on a malformed key rather than let the proxy silently drop it (and the dedupe guard).
    if (!IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)) {
      throw new ApiError('Invalid Idempotency-Key format', 0, 'INVALID_IDEMPOTENCY_KEY');
    }
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  headers['Content-Type'] = 'application/json';

  if (STATE_CHANGING_METHODS.includes(method)) {
    headers['X-CSRF-Protection'] = '1';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    return handleErrorResponse(response);
  }

  if (response.status === 204) {
    throw new ApiError('Unexpected 204 No Content response', response.status, 'UNEXPECTED_204');
  }

  return response.json() as Promise<T>;
}

async function requestVoid(method: HttpMethod, url: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CSRF-Protection': '1',
  };

  const response = await fetch(url, {
    method,
    headers,
  });

  if (!response.ok) {
    return handleErrorResponse(response);
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', url, body, options),
  put: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', url, body, options),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', url, body, options),
  delete: (url: string) => requestVoid('DELETE', url),
};
