import { NextResponse } from 'next/server';

import { updateAdminSchema } from '@/features/admins/schemas';
import { proxyToBackend } from '@/lib/api-proxy';
import { getAuthToken } from '@/lib/auth';
import { getCurrentUserIdFromToken, requireRole } from '@/lib/rbac';
import { parseJsonBody, validateId } from '@/lib/validation';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  return proxyToBackend(request, `/backoffice/admins/${id}`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = updateAdminSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, `/backoffice/admins/${id}`, { body: parsed.data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  const token = await getAuthToken();
  if (token) {
    const currentUserId = getCurrentUserIdFromToken(token);
    if (currentUserId && currentUserId === id) {
      return NextResponse.json(
        { error: { message: 'Cannot delete your own account', code: 'SELF_DELETE' } },
        { status: 400 },
      );
    }
  }

  return proxyToBackend(request, `/backoffice/admins/${id}`);
}
