import { NextResponse } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { reviewFormSchema } from '@/features/submissions/schemas';
import { parseJsonBody, validateId } from '@/lib/validation';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const error = validateId(id);
  if (error) return error;

  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = reviewFormSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request body', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, `/backoffice/submissions/${id}/review`, { body: parsed.data });
}
