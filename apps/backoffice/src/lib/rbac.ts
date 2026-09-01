import 'server-only';

import { NextResponse } from 'next/server';

import type { AdminRole } from '@/features/auth/schemas';

import { getAuthToken } from './auth';

// JWT signature is not verified here — the backend re-validates on every proxied request.
// This decode is only used for BFF-level routing decisions (role gating).
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

export async function requireRole(
  ...allowedRoles: AdminRole[]
): Promise<NextResponse | null> {
  const token = await getAuthToken();
  if (!token) {
    return NextResponse.json(
      { error: { message: 'Not authenticated', code: 'UNAUTHENTICATED' } },
      { status: 401 },
    );
  }

  const payload = decodeTokenPayload(token);
  const role = typeof payload?.role === 'string' ? payload.role : null;

  if (!role || !allowedRoles.includes(role as AdminRole)) {
    return NextResponse.json(
      { error: { message: 'Insufficient permissions', code: 'FORBIDDEN' } },
      { status: 403 },
    );
  }

  return null;
}

export function getCurrentUserIdFromToken(token: string): string | null {
  const payload = decodeTokenPayload(token);
  return typeof payload?.sub === 'string' ? payload.sub : null;
}
