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

const WALLET = 'C' + 'A'.repeat(55);

function makeRequest(body: unknown) {
  return new Request('https://app.test/api/kyc/allowlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-protection': '1' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/kyc/allowlist', () => {
  beforeEach(() => {
    proxyToBackend.mockReset().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    requireRole.mockReset().mockResolvedValue(null);
  });

  it('authenticates first, then forwards a valid add (Zod-parsed) to the backend (positive)', async () => {
    const res = await POST(makeRequest({ items: [{ wallet: WALLET, action: 'add' }] }));
    expect(res.status).toBe(200);
    // add needs only the floor role — one decode
    expect(requireRole).toHaveBeenCalledTimes(1);
    expect(requireRole).toHaveBeenCalledWith('admin', 'superadmin');
    const call = proxyToBackend.mock.calls.at(0);
    if (!call) throw new Error('proxyToBackend not called');
    expect(call[1]).toBe('/backoffice/kyc/allowlist');
    expect((call[2] as { body: unknown }).body).toEqual({ items: [{ wallet: WALLET, action: 'add' }] });
  });

  it('requires the floor role then re-checks superadmin for a remove (edge)', async () => {
    await POST(makeRequest({ items: [{ wallet: WALLET, action: 'remove' }] }));
    expect(requireRole).toHaveBeenCalledTimes(2);
    expect(requireRole).toHaveBeenNthCalledWith(1, 'admin', 'superadmin');
    expect(requireRole).toHaveBeenNthCalledWith(2, 'superadmin');
  });

  it('returns 403 from the floor role check and does not parse or proxy (negative)', async () => {
    requireRole.mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    );
    const res = await POST(makeRequest({ items: [{ wallet: WALLET, action: 'remove' }] }));
    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledTimes(1); // short-circuits before the superadmin re-check
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('authenticates before rejecting unknown fields via .strict() (edge)', async () => {
    const res = await POST(makeRequest({ items: [{ wallet: WALLET, action: 'add', evil: 1 }] }));
    expect(res.status).toBe(400);
    expect(requireRole).toHaveBeenCalledTimes(1); // auth-first: floor role checked before body validation
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('rejects a bad wallet and a >1 batch (negative)', async () => {
    const bad = await POST(makeRequest({ items: [{ wallet: 'G' + 'A'.repeat(55), action: 'add' }] }));
    expect(bad.status).toBe(400);
    const twoItems = await POST(
      makeRequest({ items: [{ wallet: WALLET, action: 'add' }, { wallet: WALLET, action: 'remove' }] }),
    );
    expect(twoItems.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body (negative)', async () => {
    const req = new Request('https://app.test/api/kyc/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-protection': '1' },
      body: '{ not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(proxyToBackend).not.toHaveBeenCalled();
  });
});
