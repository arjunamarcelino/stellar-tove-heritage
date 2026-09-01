import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { validateId } from '@/lib/validation';

import { stripSigners } from '../strip-signers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const error = validateId(id);
  if (error) return error;

  // Strip co-approver identities (data-minimization), then set `no-store` on the poll target (the proxy
  // only sets Content-Type). stripSigners preserves an existing Cache-Control, but set it explicitly here.
  const res = await stripSigners(await proxyToBackend(request, `/backoffice/offerings/${id}`));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
