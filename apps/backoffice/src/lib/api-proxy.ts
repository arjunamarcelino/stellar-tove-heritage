import 'server-only';

import { NextResponse } from 'next/server';

import { getAuthToken, clearAuthCookies, refreshTokenIfNeeded } from './auth';
import { getEnv } from './env';
import { IDEMPOTENCY_KEY_PATTERN } from './idempotency';

const CSRF_HEADER = 'x-csrf-protection';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Allow-list of client headers forwarded to the backend (not passthrough-all, to avoid smuggling).
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Re-shape a backend error response so internal details (stack traces, DB/chain errors, internal ids)
 * never reach the browser. 5xx → generic; 4xx → forward only the client-intended message + code.
 */
async function sanitizedErrorResponse(response: Response): Promise<NextResponse> {
  const status = response.status;
  if (status >= 500) {
    return NextResponse.json(
      { error: { message: 'Upstream server error', code: 'UPSTREAM_ERROR' } },
      { status },
    );
  }
  let message = 'Request failed';
  let code = 'REQUEST_FAILED';
  try {
    const raw = JSON.parse(await response.text()) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const m = raw.error?.message ?? raw.message;
    const c = raw.error?.code ?? raw.code;
    if (typeof m === 'string') message = m;
    if (typeof c === 'string') code = c;
  } catch {
    // Non-JSON body → keep the generic message/code.
  }
  return NextResponse.json({ error: { message, code } }, { status });
}

export function requireCsrf(request: Request): NextResponse | null {
  if (STATE_CHANGING_METHODS.has(request.method) && request.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json(
      { error: { message: 'Missing CSRF header', code: 'CSRF_REQUIRED' } },
      { status: 403 },
    );
  }
  return null;
}

export async function proxyToBackend(
  request: Request,
  backendPath: string,
  options?: {
    body?: unknown;
    searchParams?: URLSearchParams;
    rawBody?: ArrayBuffer;
    contentType?: string | null;
  },
): Promise<NextResponse> {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const token = await getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': options?.contentType ?? 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Forward a validated Idempotency-Key so idempotent backend actions can dedupe. This is a
  // dedupe convenience, NOT an auth control. Written into the `headers` object so it also
  // survives the 401-refresh retry below (the silent double-submit path).
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (idempotencyKey && IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let url = `${getEnv().BACKEND_API_URL}/v1${backendPath}`;
  if (options?.searchParams?.toString()) {
    url += `?${options.searchParams.toString()}`;
  }

  // Keep body buffered (not a ReadableStream) so it can be re-sent on 401 retry.
  let body: string | ArrayBuffer | undefined;
  if (options?.rawBody) {
    body = options.rawBody;
  } else if (options?.body) {
    body = JSON.stringify(options.body);
  } else if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      body = await request.text();
    } catch {
      // No body
    }
  }

  let response = await fetch(url, {
    method: request.method,
    headers,
    body,
  });

  // Attempt token refresh on 401
  if (response.status === 401 && token) {
    const refreshed = await refreshTokenIfNeeded();
    if (refreshed) {
      const newToken = await getAuthToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
      }
      response = await fetch(url, {
        method: request.method,
        headers,
        body,
      });
    } else {
      await clearAuthCookies();
      return NextResponse.json(
        { error: { message: 'Session expired', code: 'SESSION_EXPIRED' } },
        { status: 401 },
      );
    }
  }

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  // Sanitize error bodies; stream successful responses through unchanged.
  if (!response.ok) {
    return sanitizedErrorResponse(response);
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  });
}
