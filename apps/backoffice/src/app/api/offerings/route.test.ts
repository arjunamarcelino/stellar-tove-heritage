// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { proxyToBackend, requireRole } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/api-proxy', () => ({ proxyToBackend }));
vi.mock('@/lib/rbac', () => ({ requireRole }));

import { GET } from './route';

const req = (qs: string) => new NextRequest(`https://app.test/api/offerings${qs}`);
const forwardedParams = () => {
  const call = proxyToBackend.mock.calls.at(0);
  if (!call) throw new Error('proxyToBackend not called');
  return (call[2] as { searchParams: URLSearchParams }).searchParams;
};

describe('GET /api/offerings', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ data: [], meta: {} }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('requires admin/superadmin and forwards sanitized params (positive)', async () => {
    await GET(req('?status=planned&page=1&limit=20'));
    expect(requireRole).toHaveBeenCalledWith('admin', 'superadmin');
    const call = proxyToBackend.mock.calls.at(0);
    expect(call?.[1]).toBe('/backoffice/offerings');
    expect(forwardedParams().toString()).toBe('status=planned&page=1&limit=20');
  });

  it('accepts a CSV status and caps limit at 100 (edge)', async () => {
    const res = await GET(req('?status=planned,approved&limit=5000'));
    expect(forwardedParams().get('status')).toBe('planned,approved');
    expect(forwardedParams().get('limit')).toBe('100');
    expect(res.headers.get('Cache-Control')).toBe('no-store'); // list carries per-user youApproved + money
  });

  it('rejects non-canonical / unbounded numeric params (negative)', async () => {
    for (const qs of ['?page=1e10', '?page=0x10', '?page=0', '?page=200000', '?limit=-1']) {
      proxyToBackend.mockClear();
      const res = await GET(req(qs));
      expect(res.status).toBe(400);
      expect(proxyToBackend).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid status and does not proxy (negative)', async () => {
    const res = await GET(req('?status=bogus'));
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('rejects a malformed artworkId (negative)', async () => {
    const res = await GET(req(`?artworkId=${encodeURIComponent('../secret')}`));
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('returns the role error without proxying (edge)', async () => {
    requireRole.mockResolvedValue(NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }));
    const res = await GET(req(''));
    expect(res.status).toBe(403);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
