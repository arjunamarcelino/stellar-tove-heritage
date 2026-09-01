import { NextResponse } from 'next/server';

import { updateUserSchema } from '@/features/users/schemas';
import { proxyToBackend, requireCsrf } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { parseJsonBody, validateId } from '@/lib/validation';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  return proxyToBackend(request, `/backoffice/users/${id}`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = updateUserSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, `/backoffice/users/${id}`, { body: parsed.data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  return proxyToBackend(request, `/backoffice/users/${id}`);
}
