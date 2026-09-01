import { NextResponse } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { stageFormSchema } from '@/features/stages/schemas';
import { parseJsonBody, validateId } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const error = validateId(id);
  if (error) return error;
  return proxyToBackend(request, `/backoffice/stages/${id}`);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const error = validateId(id);
  if (error) return error;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = stageFormSchema.partial().safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request body', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, `/backoffice/stages/${id}`, { body: parsed.data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const error = validateId(id);
  if (error) return error;
  return proxyToBackend(request, `/backoffice/stages/${id}`);
}
