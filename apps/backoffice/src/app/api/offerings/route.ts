import { NextRequest, NextResponse } from 'next/server';

import { offeringStatusSchema } from '@/features/offerings/schemas';
import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { ID_PATTERN } from '@/lib/validation';

const VALID_STATUSES = new Set<string>(offeringStatusSchema.options);
const MAX_LIMIT = 100;
const MAX_PAGE = 100_000; // generous ceiling; blocks an unbounded page forwarded to the backend
const CANONICAL_INT = /^\d+$/; // reject '1e10' / '0x10' / '-1' etc. before Number()

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { message, code: 'VALIDATION_ERROR' } }, { status: 400 });
}

export async function GET(request: NextRequest) {
  // Auth-first: any admin may READ the approval queue; the WRITE (approve) is superadmin-gated separately.
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  // Allow-list + validate + cap query params before forwarding (money-adjacent surface; don't pass raw).
  const src = request.nextUrl.searchParams;
  const out = new URLSearchParams();

  const status = src.get('status');
  if (status !== null) {
    const tokens = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0 || tokens.some((t) => !VALID_STATUSES.has(t))) {
      return badRequest('Invalid status filter');
    }
    out.set('status', tokens.join(','));
  }

  const page = src.get('page');
  if (page !== null) {
    if (!CANONICAL_INT.test(page)) return badRequest('Invalid page');
    const n = Number(page);
    if (n < 1 || n > MAX_PAGE) return badRequest('Invalid page');
    out.set('page', String(n));
  }

  const limit = src.get('limit');
  if (limit !== null) {
    if (!CANONICAL_INT.test(limit)) return badRequest('Invalid limit');
    const n = Number(limit);
    if (n < 1) return badRequest('Invalid limit');
    out.set('limit', String(Math.min(n, MAX_LIMIT))); // hard cap (DoS amplification guard)
  }

  const artworkId = src.get('artworkId');
  if (artworkId !== null) {
    if (!ID_PATTERN.test(artworkId)) return badRequest('Invalid artworkId');
    out.set('artworkId', artworkId);
  }

  // The list body carries per-user `youApproved` + money → must not be cached (the proxy strips backend
  // cache headers, so set it here, as the detail route does).
  const res = await proxyToBackend(request, '/backoffice/offerings', { searchParams: out });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
