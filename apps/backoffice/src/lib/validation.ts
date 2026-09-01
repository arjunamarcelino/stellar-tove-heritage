import { NextResponse } from 'next/server';
import { z } from 'zod';

// Length-bounded: blocks path traversal/CRLF (inert charset) and caps abuse — UUIDs/cuids are well under 64.
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateId(id: string): NextResponse | null {
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: { message: 'Invalid ID format', code: 'INVALID_ID' } },
      { status: 400 },
    );
  }
  return null;
}

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[!@#$%^&*]/, 'Must contain a special character (!@#$%^&*)');

export async function parseJsonBody(
  request: Request,
): Promise<{ data: unknown } | { error: NextResponse }> {
  try {
    const data: unknown = await request.json();
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { error: { message: 'Invalid JSON body', code: 'INVALID_BODY' } },
        { status: 400 },
      ),
    };
  }
}
