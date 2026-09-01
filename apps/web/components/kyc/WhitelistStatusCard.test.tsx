import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WhitelistStatusResult } from '@/lib/types/api';
import { estimatedDecisionDate, formatWhitelistDate } from '@/lib/kyc/whitelistSla';

// Isolate the card's rendering from the polling machinery — the hook is exercised in its own test.
const h = vi.hoisted(() => ({
  value: { result: null as unknown, degraded: false, retry: vi.fn() },
}));
vi.mock('@/hooks/useWhitelistStatusPolling', () => ({
  useWhitelistStatusPolling: () => h.value,
}));

import WhitelistStatusCard from '@/components/kyc/WhitelistStatusCard';

function renderWith(result: WhitelistStatusResult, degraded = false) {
  h.value = { result, degraded, retry: h.value.retry };
  // `initial` is unused because the hook is mocked, but keeps the prop contract honest.
  return render(<WhitelistStatusCard initial={result} />);
}

beforeEach(() => {
  h.value = { result: null as unknown, degraded: false, retry: vi.fn() };
});

describe('WhitelistStatusCard', () => {
  it('not_submitted → points to the verification steps below (no competing CTA)', () => {
    renderWith({ status: 'success', data: { status: 'not_submitted' } });
    expect(screen.getByText('Not yet whitelisted')).toBeInTheDocument();
    expect(screen.getByText(/steps below/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('pending_review → shows an estimated decision date computed from last_submission_at', () => {
    const lastSubmissionAt = '2099-01-05T00:00:00Z'; // far future → never past-due
    renderWith({ status: 'success', data: { status: 'pending_review', lastSubmissionAt } });
    const expected = formatWhitelistDate(estimatedDecisionDate(lastSubmissionAt));
    expect(screen.getByText(/Pending review/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Estimated decision by ${expected}`))).toBeInTheDocument();
  });

  it('pending_review with no last_submission_at → generic reviewing copy, no date', () => {
    renderWith({ status: 'success', data: { status: 'pending_review', lastSubmissionAt: null } });
    expect(screen.getByText(/reviewing your submission/i)).toBeInTheDocument();
    expect(screen.queryByText(/Estimated decision by/i)).toBeNull();
  });

  it('whitelisted → success treatment with the formatted whitelisted_at date', () => {
    renderWith({
      status: 'success',
      data: { status: 'whitelisted', whitelistedAt: '2026-07-17T00:00:00Z' },
    });
    expect(screen.getByText('Whitelisted')).toBeInTheDocument();
    expect(screen.getByText(/Verified on 17 Jul 2026/i)).toBeInTheDocument();
  });

  it('frozen → renders the server-resolved reasonCopy + contact-support mailto, role="alert"', () => {
    renderWith({
      status: 'success',
      data: { status: 'frozen', reasonCopy: 'Your verification is temporarily on hold.' },
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/temporarily on hold/i);
    const link = screen.getByRole('link', { name: /contact support/i });
    expect(link).toHaveAttribute('href', 'mailto:support@toveheritage.com');
    // Destructive states are announced via role="alert", so the polite live region stays empty (no
    // double announcement) — locks the WHITELIST_STATE_A11Y announce/alert contract.
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('removed → destructive banner with server-resolved reasonCopy + contact support', () => {
    renderWith({
      status: 'success',
      data: { status: 'removed', reasonCopy: 'Your verification has been revoked.' },
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/revoked/i);
    expect(screen.getByRole('link', { name: /contact support/i })).toBeInTheDocument();
  });

  it('error result → shows the curated message; degraded surfaces a working Retry', () => {
    renderWith({ status: 'error', code: 'SERVER_ERROR', message: 'Something went wrong.' }, true);
    expect(screen.getByText(/Status unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.value.retry).toHaveBeenCalledTimes(1);
  });

  it('error result while still retrying (not degraded) → no Retry button', () => {
    renderWith({ status: 'error', code: 'NETWORK_ERROR', message: 'net' }, false);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
