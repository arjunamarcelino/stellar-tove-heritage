// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { proxyToBackend, requireRole } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/api-proxy', () => ({ proxyToBackend }));
vi.mock('@/lib/rbac', () => ({ requireRole }));

import { POST } from './route';

const validBody = {
  totalSupply: 100,
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 365,
  treasuryLockupDays: 730,
  name: 'Northern Lights',
  symbol: 'NLIGHT',
};

function makeRequest(body: unknown) {
  return new Request('https://app.test/api/artworks/abc/fractionalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-protection': '1' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'abc' }) };

describe('POST /api/artworks/[id]/fractionalize', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ ok: true }, { status: 202 }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('forwards a valid body (Zod-parsed) to the backend (positive)', async () => {
    const res = await POST(makeRequest(validBody), ctx);
    expect(res.status).toBe(202);
    expect(proxyToBackend).toHaveBeenCalledTimes(1);
    const call = proxyToBackend.mock.calls.at(0);
    if (!call) throw new Error('proxyToBackend not called');
    expect(call[1]).toBe('/backoffice/artworks/abc/fractionalize');
    expect((call[2] as { body: unknown }).body).toMatchObject({ symbol: 'NLIGHT' });
  });

  it('rejects sum > 100 before proxying (negative)', async () => {
    const res = await POST(
      makeRequest({ ...validBody, artistRetentionPct: 60, treasuryRetentionPct: 50 }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('rejects unknown fields via .strict() so they never reach the deploy (edge)', async () => {
    const res = await POST(makeRequest({ ...validBody, evil: 1 }), ctx);
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('returns the role error and does not proxy when unauthorized (edge)', async () => {
    requireRole.mockResolvedValue(
      NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    );
    const res = await POST(makeRequest(validBody), ctx);
    expect(res.status).toBe(403);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
