// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { proxyToBackend, requireRole } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/api-proxy', () => ({ proxyToBackend }));
vi.mock('@/lib/rbac', () => ({ requireRole }));
vi.mock('server-only', () => ({})); // strip-signers.ts imports it; no-op under @vitest-environment node

import { POST } from './route';

const makeReq = () =>
  new Request('https://app.test/api/offerings/o1/approve', {
    method: 'POST',
    headers: { 'x-csrf-protection': '1', 'idempotency-key': 'key-1234-5678' },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/offerings/[id]/approve', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ ok: true }, { status: 202 }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('requires ADMIN or SUPERADMIN (roster is the backend gate) and forwards a fixed empty body (positive)', async () => {
    const res = await POST(makeReq(), ctx('o1'));
    expect(requireRole).toHaveBeenCalledWith('admin', 'superadmin');
    expect(res.status).toBe(202);
    const call = proxyToBackend.mock.calls.at(0);
    expect(call?.[1]).toBe('/backoffice/offerings/o1/approve');
    expect((call?.[2] as { body: unknown }).body).toEqual({});
  });

  it('returns the role error without proxying (negative)', async () => {
    requireRole.mockResolvedValue(NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }));
    const res = await POST(makeReq(), ctx('o1'));
    expect(res.status).toBe(403);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('rejects a malformed id and does not proxy (negative)', async () => {
    const res = await POST(makeReq(), ctx('bad id!'));
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
