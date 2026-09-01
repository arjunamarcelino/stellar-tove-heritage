// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { proxyToBackend, requireRole } = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/api-proxy', () => ({ proxyToBackend }));
vi.mock('@/lib/rbac', () => ({ requireRole }));

import { GET } from './route';

const WALLET = 'C' + 'A'.repeat(55);

function ctx(wallet: string) {
  return { params: Promise.resolve({ wallet }) };
}

function req() {
  return new Request('https://app.test/api/kyc/allowlist/x') as never;
}

describe('GET /api/kyc/allowlist/[wallet]', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('forwards a valid wallet to the backend (positive)', async () => {
    const res = await GET(req(), ctx(WALLET));
    expect(res.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith('admin', 'superadmin');
    expect(proxyToBackend.mock.calls.at(0)?.[1]).toBe(`/backoffice/kyc/allowlist/${WALLET}`);
  });

  it('returns 400 for a malformed wallet before any role decode, no proxy (negative)', async () => {
    const res = await GET(req(), ctx('G' + 'A'.repeat(55)));
    expect(res.status).toBe(400);
    expect(requireRole).not.toHaveBeenCalled(); // validate-first
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('returns the role error and does not proxy when unauthorized (edge)', async () => {
    requireRole.mockResolvedValue(NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }));
    const res = await GET(req(), ctx(WALLET));
    expect(res.status).toBe(403);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
