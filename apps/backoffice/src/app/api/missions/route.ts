import { NextRequest, NextResponse } from 'next/server';

import { proxyToBackend } from '@/lib/api-proxy';
import { missionFormSchema } from '@/features/missions/schemas';
import { parseJsonBody } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return proxyToBackend(request, '/backoffice/missions', { searchParams });
}

export async function POST(request: Request) {
  const result = await parseJsonBody(request);
  if ('error' in result) return result.error;

  const parsed = missionFormSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request body', code: 'VALIDATION_ERROR' } },
      { status: 400 },
    );
  }

  return proxyToBackend(request, '/backoffice/missions', { body: parsed.data });
}
