import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Isolate the Server Component dispatcher — stub the client panel so this test doesn't pull the server action.
vi.mock('@/components/quote/QuotePanel', () => ({
  default: ({ rfqId }: { rfqId: string }) => <div data-testid="quote-panel">{rfqId}</div>,
}));
// RetryButton (shared) calls useRouter().refresh() — provide a router in the test environment.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import QuoteSection from '@/components/quote/QuoteSection';

const RFQ = '7a9c0000-0000-4000-8000-000000000001';

describe('QuoteSection (gate dispatch)', () => {
  it('anonymous → sign-in gate, no panel', () => {
    render(<QuoteSection rfqId={RFQ} isSignedIn={false} isWhitelisted={false} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId('quote-panel')).not.toBeInTheDocument();
  });

  it('signed-in, whitelist read failed → neutral load-error retry (NOT the KYC gate)', () => {
    render(<QuoteSection rfqId={RFQ} isSignedIn={true} isWhitelisted={false} readFailed={true} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /complete kyc/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-panel')).not.toBeInTheDocument();
  });

  it('signed-in, not whitelisted (read ok) → complete-KYC gate, no panel', () => {
    render(<QuoteSection rfqId={RFQ} isSignedIn={true} isWhitelisted={false} />);
    expect(screen.getByRole('link', { name: /complete kyc/i })).toBeInTheDocument();
    expect(screen.queryByTestId('quote-panel')).not.toBeInTheDocument();
  });

  it('whitelisted → renders the panel and shows the authoritative rfqId', () => {
    render(<QuoteSection rfqId={RFQ} isSignedIn={true} isWhitelisted={true} />);
    expect(screen.getByTestId('quote-panel')).toHaveTextContent(RFQ);
    expect(screen.getByText(/#7a9c0000/i)).toBeInTheDocument(); // truncated authoritative id
  });
});
