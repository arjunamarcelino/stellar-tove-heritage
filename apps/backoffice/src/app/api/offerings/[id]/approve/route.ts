import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { validateId } from '@/lib/validation';

import { stripSigners } from '../../strip-signers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Approve is ADMIN or SUPERADMIN — the ROSTER is the gate, not the role (confirmed TOV-154 contract,
  // 2026-08-20). Roster membership + 4-eyes distinctness are enforced backend-side (the BFF can't see the
  // roster); off-roster → 403 OFFERING_APPROVAL_NOT_A_SIGNER from the backend. proxyToBackend enforces
  // CSRF and forwards the Idempotency-Key header.
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const error = validateId(id);
  if (error) return error;

  // Forward a fixed empty body — the action carries no payload, so anything the client sent is ignored.
  // Strip co-approver identities from the 202 before it reaches the browser (data-minimization).
  return stripSigners(await proxyToBackend(request, `/backoffice/offerings/${id}/approve`, { body: {} }));
}
