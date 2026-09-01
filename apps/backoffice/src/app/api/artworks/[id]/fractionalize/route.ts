import { NextResponse } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { validateId, parseJsonBody } from '@/lib/validation';
import { fractionalizeFormSchema } from '@/features/artworks/schemas';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const idError = validateId(id);
  if (idError) return idError;

  // BFF defense-in-depth — the backend re-enforces admin on this money-adjacent route.
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = fractionalizeFormSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request body', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  // Forward the Zod-parsed data (never the raw stream) so unknown fields can't reach the deploy.
  return proxyToBackend(request, `/backoffice/artworks/${id}/fractionalize`, { body: parsed.data });
}
