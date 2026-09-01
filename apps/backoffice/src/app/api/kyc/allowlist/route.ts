import { NextResponse } from 'next/server';

import { allowlistBatchRequestSchema } from '@/features/kyc-allowlist/schemas';
import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/validation';

export async function POST(request: Request) {
  // No explicit requireCsrf — proxyToBackend enforces CSRF internally (matches the fractionalize route).
  // Auth-first: authenticate + require the FLOOR role before doing any body work, so an unauthenticated
  // caller never reaches JSON/Zod validation (matches the validate→auth→parse order of the reference route).
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = allowlistBatchRequestSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request body', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  // BFF defense-in-depth (backend re-enforces): a `remove` item additionally requires superadmin.
  // The extra in-process decode is negligible; `.some` keeps a hypothetical mixed [add, remove] batch
  // correct even though the UI sends exactly one item.
  if (parsed.data.items.some((item) => item.action === 'remove')) {
    const superadminError = await requireRole('superadmin');
    if (superadminError) return superadminError;
  }

  // Forward the Zod-parsed data (never the raw stream) so unknown fields can't reach the on-chain write.
  return proxyToBackend(request, '/backoffice/kyc/allowlist', { body: parsed.data });
}
