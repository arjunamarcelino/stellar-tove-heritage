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

import { GET } from './route';

const makeReq = () => new Request('https://app.test/api/offerings/o1');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/offerings/[id]', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ id: 'o1' }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('gates on admin/superadmin, validates id, sets Cache-Control:no-store (positive)', async () => {
    const res = await GET(makeReq(), ctx('o1'));
    expect(requireRole).toHaveBeenCalledWith('admin', 'superadmin');
    expect(proxyToBackend.mock.calls.at(0)?.[1]).toBe('/backoffice/offerings/o1');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('strips approvals.signers from the body while preserving i128 money (data-minimization)', async () => {
    proxyToBackend.mockResolvedValueOnce(
      NextResponse.json({
        id: 'o1',
        lowPriceStroops: '170141183460469231731687303715884105727',
        approvals: { count: 1, threshold: 2, signers: ['sub1', 'sub2'] },
      }),
    );
    const res = await GET(makeReq(), ctx('o1'));
    const body = await res.json();
    expect(body.approvals.signers).toBeUndefined();
    expect(body.approvals.count).toBe(1);
    expect(body.lowPriceStroops).toBe('170141183460469231731687303715884105727');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a malformed id and does not proxy (negative)', async () => {
    const res = await GET(makeReq(), ctx('bad/../id'));
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('returns the role error without proxying (edge)', async () => {
    requireRole.mockResolvedValue(NextResponse.json({ error: {} }, { status: 401 }));
    const res = await GET(makeReq(), ctx('o1'));
    expect(res.status).toBe(401);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
