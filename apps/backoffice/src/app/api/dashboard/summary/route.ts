import type { NextRequest } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const roleError = await requireRole('admin', 'superadmin');
  if (roleError) return roleError;

  return proxyToBackend(request, '/backoffice/dashboard/summary');
}
