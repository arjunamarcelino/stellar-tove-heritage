import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WhitelistStatusResult } from '@/lib/types/api';

// The page reads the token via lib/cookies (server-only) — stub it so the module loads in the test.
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  getWhitelistStatus: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/lib/services/kyc', () => ({ getWhitelistStatus: h.getWhitelistStatus }));
// Stub the section so the SSR branch is observable via echoed props (and no client subtree is pulled).
vi.mock('@/components/quote/QuoteSection', () => ({
  default: ({
    rfqId,
    isSignedIn,
    isWhitelisted,
    readFailed,
  }: {
    rfqId: string;
    isSignedIn: boolean;
    isWhitelisted: boolean;
    readFailed?: boolean;
  }) => (
    <div
      data-testid="section"
      data-signed-in={String(isSignedIn)}
      data-whitelisted={String(isWhitelisted)}
      data-read-failed={String(!!readFailed)}
    >
      {rfqId}
    </div>
  ),
}));

import QuotePage from '@/app/(public)/marketplace/rfqs/[rfqId]/quote/page';

const RFQ = '7a9c0000-0000-4000-8000-000000000001';
const ok = (r: WhitelistStatusResult) => r;

async function renderPage(rfqId = RFQ) {
  render(await QuotePage({ params: Promise.resolve({ rfqId }) }));
  return screen.getByTestId('section');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' });
});

describe('QuotePage (SSR branches)', () => {
  it('malformed rfqId → notFound()', async () => {
    await expect(QuotePage({ params: Promise.resolve({ rfqId: 'not-a-uuid' }) })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
    expect(h.notFound).toHaveBeenCalled();
    expect(h.getWhitelistStatus).not.toHaveBeenCalled();
  });

  it('no token → not signed in (anon), whitelist read skipped', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    const s = await renderPage();
    expect(s).toHaveAttribute('data-signed-in', 'false');
    expect(h.getWhitelistStatus).not.toHaveBeenCalled();
  });

  it('token + whitelisted → signed-in + whitelisted', async () => {
    h.getWhitelistStatus.mockResolvedValue(
      ok({ status: 'success', data: { status: 'whitelisted', whitelistedAt: null } }),
    );
    const s = await renderPage();
    expect(s).toHaveAttribute('data-signed-in', 'true');
    expect(s).toHaveAttribute('data-whitelisted', 'true');
    expect(s).toHaveAttribute('data-read-failed', 'false');
  });

  it('token + not whitelisted (read ok) → signed-in, not whitelisted, not read-failed', async () => {
    h.getWhitelistStatus.mockResolvedValue(
      ok({ status: 'success', data: { status: 'not_submitted' } }),
    );
    const s = await renderPage();
    expect(s).toHaveAttribute('data-signed-in', 'true');
    expect(s).toHaveAttribute('data-whitelisted', 'false');
    expect(s).toHaveAttribute('data-read-failed', 'false');
  });

  it('token + whitelist 5xx → read-failed (C7: neutral, NOT the KYC gate)', async () => {
    h.getWhitelistStatus.mockResolvedValue(
      ok({ status: 'error', code: 'SERVER_ERROR', message: 'x' }),
    );
    const s = await renderPage();
    expect(s).toHaveAttribute('data-signed-in', 'true');
    expect(s).toHaveAttribute('data-read-failed', 'true');
  });

  it('token + SESSION_EXPIRED → degrade to anon (not signed in), not read-failed', async () => {
    h.getWhitelistStatus.mockResolvedValue(
      ok({ status: 'error', code: 'SESSION_EXPIRED', message: 'stale' }),
    );
    const s = await renderPage();
    expect(s).toHaveAttribute('data-signed-in', 'false');
    expect(s).toHaveAttribute('data-read-failed', 'false');
  });
});
