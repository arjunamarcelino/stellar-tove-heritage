import { NextResponse } from 'next/server';

import { backendTokenResponseSchema, loginCredentialsSchema } from '@/features/auth/schemas';
import { requireCsrf } from '@/lib/api-proxy';
import { setAuthCookies } from '@/lib/auth';
import { getEnv } from '@/lib/env';

export async function POST(request: Request) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: 'Invalid JSON body', code: 'INVALID_BODY' } },
      { status: 400 },
    );
  }

  const parsed = loginCredentialsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid credentials format', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  const response = await fetch(`${getEnv().BACKEND_API_URL}/v1/backoffice/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 401;
    const message =
      status === 429
        ? 'Too many attempts, please try again later'
        : 'Invalid email or password';
    return NextResponse.json(
      { error: { message, code: status === 429 ? 'RATE_LIMITED' : 'AUTH_FAILED' } },
      { status },
    );
  }

  const data = await response.json();
  const backendParsed = backendTokenResponseSchema.safeParse(data);
  if (!backendParsed.success) {
    return NextResponse.json(
      { error: { message: 'Unexpected response from auth server', code: 'PARSE_ERROR' } },
      { status: 502 },
    );
  }

  await setAuthCookies(backendParsed.data.accessToken, backendParsed.data.refreshToken);

  return NextResponse.json({ success: true });
}
