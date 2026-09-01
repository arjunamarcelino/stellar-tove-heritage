import { NextResponse, type NextRequest } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { isValidContractAddress } from '@/lib/stellar';

export async function GET(request: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;

  // Validate the path segment first (matches the fractionalize reference: validate → auth), so a
  // malformed path is rejected without a role decode. Precise C… StrKey check (ID_PATTERN is too loose).
  if (!isValidContractAddress(wallet)) {
    return NextResponse.json(
      { error: { message: 'Invalid wallet address', code: 'INVALID_WALLET' } },
      { status: 400 },
    );
  }

  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  return proxyToBackend(request, `/backoffice/kyc/allowlist/${wallet}`);
}
