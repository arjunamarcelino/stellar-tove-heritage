import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Isolate the Server Component dispatcher — stub the client panel so this test doesn't pull the server action.
vi.mock('@/components/rfq/RfqPanel', () => ({
  default: ({ artworkId }: { artworkId: string }) => <div data-testid="rfq-panel">{artworkId}</div>,
}));

import RfqSection from '@/components/rfq/RfqSection';
import { ARTWORK_ID } from '@/test/fixtures/rfq';

describe('RfqSection (gate dispatch)', () => {
  it('anonymous → sign-in gate, no panel', () => {
    render(<RfqSection artworkId={ARTWORK_ID} isSignedIn={false} isWhitelisted={false} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId('rfq-panel')).not.toBeInTheDocument();
  });

  it('signed-in, not whitelisted → complete-KYC gate, no panel', () => {
    render(<RfqSection artworkId={ARTWORK_ID} isSignedIn={true} isWhitelisted={false} />);
    expect(screen.getByRole('link', { name: /complete kyc/i })).toBeInTheDocument();
    expect(screen.queryByTestId('rfq-panel')).not.toBeInTheDocument();
  });

  it('whitelisted + fractionalized false → "not available" note, no panel', () => {
    render(
      <RfqSection
        artworkId={ARTWORK_ID}
        isSignedIn={true}
        isWhitelisted={true}
        fractionalized={false}
      />,
    );
    expect(screen.getByText(/isn’t available for offers yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('rfq-panel')).not.toBeInTheDocument();
  });

  it('whitelisted + fractionalized unknown → renders the panel (render-and-error default)', () => {
    render(<RfqSection artworkId={ARTWORK_ID} isSignedIn={true} isWhitelisted={true} />);
    expect(screen.getByTestId('rfq-panel')).toHaveTextContent(ARTWORK_ID);
  });
});
