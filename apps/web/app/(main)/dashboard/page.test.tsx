import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  redirect: vi.fn((): never => {
    throw new Error('REDIRECT');
  }),
  getHoldings: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@/lib/services/holdings', () => ({ getHoldings: h.getHoldings }));

import DashboardPage, { HoldingsSection } from '@/app/(main)/dashboard/page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage auth gate', () => {
  it('redirects to /login when no access-token cookie is present', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    await expect(DashboardPage()).rejects.toThrow('REDIRECT');
    expect(h.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders (does not redirect) when a token is present', async () => {
    h.cookieStore.get.mockReturnValue({ value: 'tok' });
    const element = await DashboardPage();
    expect(element).toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });
});

describe('HoldingsSection SSR read', () => {
  it('redirects to /login when the SSR holdings read returns SESSION_EXPIRED', async () => {
    h.getHoldings.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    await expect(HoldingsSection({ token: 'tok' })).rejects.toThrow('REDIRECT');
    expect(h.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders the widget (no redirect) on a successful read', async () => {
    h.getHoldings.mockResolvedValue({ status: 'success', holdings: [], droppedCount: 0 });
    const element = await HoldingsSection({ token: 'tok' });
    expect(element).toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it('does not redirect on a non-session error (renders the widget with the error result)', async () => {
    h.getHoldings.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    const element = await HoldingsSection({ token: 'tok' });
    expect(element).toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
