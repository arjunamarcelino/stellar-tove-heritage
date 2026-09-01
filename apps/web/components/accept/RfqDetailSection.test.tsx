import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/accept/RfqDetailPanel', () => ({
  default: () => <div data-testid="panel" />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import RfqDetailSection from '@/components/accept/RfqDetailSection';
import { RFQ_ID, rfqDetail } from '@/test/fixtures/accept';
import type { RfqDetailResult } from '@/lib/types/api';

const ok: RfqDetailResult = { status: 'success', rfq: rfqDetail };
const anon: RfqDetailResult = { status: 'error', code: 'SESSION_EXPIRED', message: '' };
const notFound: RfqDetailResult = { status: 'error', code: 'RFQ_NOT_FOUND', message: '' };
const transient: RfqDetailResult = { status: 'error', code: 'NETWORK_ERROR', message: '' };

describe('RfqDetailSection', () => {
  it('anonymous → sign-in gate, no panel', () => {
    render(<RfqDetailSection rfqId={RFQ_ID} isSignedIn={false} result={anon} seedTrade={null} />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.querySelector('[data-gate="sign-in"]')).toBeInTheDocument();
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('success → renders the panel', () => {
    render(<RfqDetailSection rfqId={RFQ_ID} isSignedIn result={ok} seedTrade={null} />);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('not-found → informative gate, no panel', () => {
    render(<RfqDetailSection rfqId={RFQ_ID} isSignedIn result={notFound} seedTrade={null} />);
    expect(document.querySelector('[data-gate="not-found"]')).toBeInTheDocument();
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('transient read error → load-error retry', () => {
    render(<RfqDetailSection rfqId={RFQ_ID} isSignedIn result={transient} seedTrade={null} />);
    expect(document.querySelector('[data-gate="read-failed"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
