import { NextResponse } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { requireRole } from '@/lib/rbac';
import { validateId } from '@/lib/validation';
import { MAX_UPLOAD_SIZE } from '@/features/files/schemas';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roleError = await requireRole('superadmin');
  if (roleError) return roleError;

  const { id } = await params;
  const idError = validateId(id);
  if (idError) return idError;

  return proxyToBackend(request, `/backoffice/files/${id}`);
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

  return proxyToBackend(request, `/backoffice/files/${id}`, { rawBody, contentType });
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

  return proxyToBackend(request, `/backoffice/files/${id}`);
}
