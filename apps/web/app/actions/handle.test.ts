import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  setHandle: vi.fn(),
  redirect: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock('@/lib/services/handle', () => ({ setHandle: h.setHandle }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));

import { setHandleAction } from '@/app/actions/handle';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' }); // authenticated by default
});

describe('setHandleAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    expect(await setHandleAction('Maya')).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.setHandle).not.toHaveBeenCalled();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it('rejects a malformed handle before delegating', async () => {
    expect(await setHandleAction('a')).toMatchObject({
      status: 'error',
      code: 'HANDLE_FORMAT_INVALID',
    });
    expect(h.setHandle).not.toHaveBeenCalled();
  });

  it('delegates the trimmed handle with the cookie token', async () => {
    h.setHandle.mockResolvedValue({ status: 'success', handle: 'Maya', handleCanonical: 'maya' });
    await setHandleAction('  Maya  ');
    expect(h.setHandle).toHaveBeenCalledWith('tok', 'Maya');
  });

  it('server-redirects to /dashboard on success', async () => {
    h.setHandle.mockResolvedValue({ status: 'success', handle: 'Maya', handleCanonical: 'maya' });
    await setHandleAction('Maya');
    expect(h.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('returns the service error result without redirecting', async () => {
    h.setHandle.mockResolvedValue({ status: 'error', code: 'HANDLE_TAKEN', message: 'taken' });
    expect(await setHandleAction('Maya')).toMatchObject({ status: 'error', code: 'HANDLE_TAKEN' });
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
