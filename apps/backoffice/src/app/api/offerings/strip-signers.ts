import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Remove `approvals.signers` from a SUCCESSFUL offerings response before it reaches the browser —
 * co-approver identities must not leak to other approvers (anti-collusion; todo 094). The client
 * consumes only `count`/`threshold`/`youApproved`.
 *
 * Re-serializing is safe here specifically because all money fields are i128 STRINGS
 * (`JSON.parse`→`JSON.stringify` preserves strings byte-identically) and no bare number in the body
 * exceeds 2^53. Do NOT copy this pattern to a response that carries i128 as bare JSON numbers.
 *
 * Non-2xx / non-JSON responses pass through untouched (error bodies are already sanitized upstream).
 */
export async function stripSigners(res: NextResponse): Promise<NextResponse> {
  if (!res.ok) return res;
  if (!(res.headers.get('Content-Type') ?? '').includes('application/json')) return res;

  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return res;
  }

  if (body && typeof body === 'object' && 'approvals' in body) {
    const approvals = (body as { approvals?: Record<string, unknown> }).approvals;
    if (approvals && typeof approvals === 'object') delete approvals.signers;
  }

  const out = NextResponse.json(body, { status: res.status });
  const cacheControl = res.headers.get('Cache-Control');
  if (cacheControl) out.headers.set('Cache-Control', cacheControl);
  return out;
}
