import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KycNoticeBanner from '@/components/beneficiary/KycNoticeBanner';

describe('KycNoticeBanner', () => {
  it("renders the curated KYC banner for code 'KYC_REQUIRED_FOR_TRANSFER'", () => {
    render(<KycNoticeBanner code="KYC_REQUIRED_FOR_TRANSFER" />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(/KYC verification/i);
  });

  it('renders nothing when code is null', () => {
    const { container } = render(<KycNoticeBanner code={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unknown code', () => {
    const { container } = render(<KycNoticeBanner code="SOME_OTHER_CODE" />);
    expect(container).toBeEmptyDOMElement();
  });
});
