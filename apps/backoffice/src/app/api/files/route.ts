import { NextResponse, type NextRequest } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { MAX_UPLOAD_SIZE } from '@/features/files/schemas';

export async function GET(request: NextRequest) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  return proxyToBackend(request, '/backoffice/files', {
    searchParams: request.nextUrl.searchParams,
  });
}

export async function POST(request: Request) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const contentType = request.headers.get('content-type');
  if (!contentType?.startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: { message: 'Expected multipart/form-data', code: 'INVALID_CONTENT_TYPE' } },
      { status: 400 },
    );
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: { message: 'File too large', code: 'PAYLOAD_TOO_LARGE' } },
      { status: 413 },
    );
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: { message: 'File too large', code: 'PAYLOAD_TOO_LARGE' } },
      { status: 413 },
    );
  }

  return proxyToBackend(request, '/backoffice/files', { rawBody, contentType });
}
