import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Route } from 'next';
import type { KycWizardState } from '@/lib/types/api';

const hook = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/useKycSubmission', () => ({ useKycSubmission: () => hook.value }));

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import KycWizard from '@/components/kyc/KycWizard';

function stubHook(state: KycWizardState) {
  return {
    state,
    jurisdiction: 'GB' as const,
    files: {},
    selectJurisdiction: vi.fn(),
    setDocument: vi.fn(),
    removeDocument: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    submit: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
  };
}

const HREF = '/settings/kyc' as Route;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KycWizard', () => {
  it('marks the active step with aria-current and moves focus to the heading', () => {
    hook.value = stubHook({ status: 'documents' });
    render(<KycWizard statusHref={HREF} />);
    const heading = screen.getByRole('heading', { level: 2, name: /upload your documents/i });
    expect(heading).toHaveFocus();
    expect(screen.getByText('Documents').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('announces the current step in a polite live region', () => {
    hook.value = stubHook({ status: 'jurisdiction' });
    render(<KycWizard statusHref={HREF} />);
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('Step 1 of 3');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('renders a retryable error with an alert and a working Try again action', () => {
    const h = stubHook({
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Oops.',
      retryable: true,
    });
    hook.value = h;
    render(<KycWizard statusHref={HREF} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Oops.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.retry).toHaveBeenCalled();
  });

  it('omits Try again for a non-retryable error (rate limited)', () => {
    hook.value = stubHook({
      status: 'error',
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      retryable: false,
    });
    render(<KycWizard statusHref={HREF} />);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('redirects to login on session expiry', () => {
    hook.value = stubHook({ status: 'sessionExpired' });
    render(<KycWizard statusHref={HREF} />);
    expect(router.replace).toHaveBeenCalledWith('/login');
  });
});
