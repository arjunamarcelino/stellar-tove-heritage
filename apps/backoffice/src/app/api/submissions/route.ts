import { NextRequest } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return proxyToBackend(request, '/backoffice/submissions', { searchParams });
}
