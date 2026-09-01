import { NextResponse, type NextRequest } from 'next/server';

import { createUserSchema } from '@/features/users/schemas';
import { proxyToBackend, requireCsrf } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  return proxyToBackend(request, '/backoffice/users', {
    searchParams: request.nextUrl.searchParams,
  });
}

export async function POST(request: Request) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = createUserSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, '/backoffice/users', { body: parsed.data });
}
