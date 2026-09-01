import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpenQuotesList from '@/components/accept/OpenQuotesList';
import { openQuote } from '@/test/fixtures/accept';
import type { OpenQuote } from '@/lib/types/api';

const quote = (o: Partial<OpenQuote> = {}): OpenQuote => ({ ...openQuote, ...o });

function renderList(props: Partial<Parameters<typeof OpenQuotesList>[0]> = {}) {
  const onAccept = vi.fn();
  const onRefresh = vi.fn();
  render(
    <OpenQuotesList
      quotes={[quote()]}
      passkeySupported
      onAccept={onAccept}
      onRefresh={onRefresh}
      {...props}
    />,
  );
  return { onAccept, onRefresh };
}

describe('OpenQuotesList', () => {
  it('renders a row with seller handle, count/price, and net cost', () => {
    renderList();
    expect(screen.getByText('@seller')).toBeInTheDocument();
    expect(screen.getByText(/500 fractions/)).toBeInTheDocument();
    expect(screen.getByText('1,000.00 USDC')).toBeInTheDocument(); // gross 10,000,000,000 stroops
  });

  it('enables Accept for an acceptable quote and calls onAccept with the quote', async () => {
    const { onAccept } = renderList();
    const btn = screen.getByRole('button', { name: 'Accept' });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ quoteId: openQuote.quoteId }));
  });

  it('disables Accept for a non-acceptable quote (data-cta-disabled-reason)', () => {
    renderList({ quotes: [quote({ acceptable: false })] });
    const btn = screen.getByRole('button', { name: 'Accept' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('data-cta-disabled-reason', 'not-acceptable');
  });

  // Note: AC-B (one trade per RFQ) is enforced by the coordinator REPLACING the list with the settlement panel
  // once a trade exists — covered by RfqDetailPanel.test.tsx, not a per-row gate (todo 186).

  it('disables Accept when passkeys are unsupported', () => {
    renderList({ passkeySupported: false });
    expect(screen.getByRole('button', { name: 'Accept' })).toHaveAttribute(
      'data-cta-disabled-reason',
      'passkey-unsupported',
    );
  });

  it('shows the empty state when there are no quotes', () => {
    renderList({ quotes: [] });
    expect(screen.getByText(/No quotes yet/)).toBeInTheDocument();
  });

  it('shows the all-unacceptable banner when no quote is acceptable', () => {
    renderList({ quotes: [quote({ acceptable: false })] });
    expect(screen.getByText(/still needs to authorize/)).toBeInTheDocument();
  });
});
