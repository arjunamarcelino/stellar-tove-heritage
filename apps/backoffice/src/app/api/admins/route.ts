import { NextResponse, type NextRequest } from 'next/server';

import { registerAdminSchema } from '@/features/admins/schemas';
import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  return proxyToBackend(request, '/backoffice/admins', {
    searchParams: request.nextUrl.searchParams,
  });
}

// POST /api/admins -> /backoffice/auth/register
export async function POST(request: Request) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = registerAdminSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, '/backoffice/auth/register', { body: parsed.data });
}
