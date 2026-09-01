import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import BeneficiaryChangeSummary from '@/components/beneficiary/BeneficiaryChangeSummary';
import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';

const PK = Keypair.random().publicKey();

const FILLED: BeneficiaryFormValues = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: PK,
  relationship: 'spouse',
  notes: 'Longtime partner',
};

describe('BeneficiaryChangeSummary', () => {
  describe("mode='create'", () => {
    it('renders all five labels and their values', () => {
      render(<BeneficiaryChangeSummary mode="create" baseline={null} next={FILLED} />);
      for (const label of ['Name', 'Email', 'Stellar address', 'Relationship', 'Notes']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      expect(screen.getByText('spouse')).toBeInTheDocument();
      expect(screen.getByText('Longtime partner')).toBeInTheDocument();
    });

    it('renders an em dash for an empty optional field', () => {
      render(
        <BeneficiaryChangeSummary mode="create" baseline={null} next={{ ...FILLED, notes: '' }} />,
      );
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders the full untruncated 56-char Stellar key', () => {
      render(<BeneficiaryChangeSummary mode="create" baseline={null} next={FILLED} />);
      expect(PK).toHaveLength(56);
      expect(screen.getByText(PK)).toBeInTheDocument();
    });

    it('renders an untrusted name as literal text (no injected script element)', () => {
      const { container } = render(
        <BeneficiaryChangeSummary
          mode="create"
          baseline={null}
          next={{ ...FILLED, name: '<script>alert(1)</script>' }}
        />,
      );
      expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe("mode='update'", () => {
    const baseline: BeneficiaryFormValues = {
      name: 'Jane Doe',
      email: 'a@x.com',
      stellarPubkey: '',
      relationship: 'spouse',
      notes: '',
    };
    const next: BeneficiaryFormValues = {
      name: 'Jane Doe',
      email: 'b@x.com',
      stellarPubkey: '',
      relationship: '',
      notes: '',
    };

    it('shows a changed field as old → new', () => {
      render(<BeneficiaryChangeSummary mode="update" baseline={baseline} next={next} />);
      expect(screen.getByText('a@x.com')).toBeInTheDocument();
      expect(screen.getByText('b@x.com')).toBeInTheDocument();
    });

    it("renders 'removed' when an optional field is cleared", () => {
      render(<BeneficiaryChangeSummary mode="update" baseline={baseline} next={next} />);
      expect(screen.getByText('spouse')).toBeInTheDocument();
      expect(screen.getByText('removed')).toBeInTheDocument();
    });

    it('does not render an unchanged field', () => {
      render(<BeneficiaryChangeSummary mode="update" baseline={baseline} next={next} />);
      // name is identical in baseline and next → not part of the diff
      expect(screen.queryByText('Jane Doe')).toBeNull();
      expect(screen.queryByText('Name')).toBeNull();
    });
  });

  describe("mode='remove'", () => {
    it('shows the baseline name and email', () => {
      render(
        <BeneficiaryChangeSummary
          mode="remove"
          baseline={{ ...FILLED, email: 'a@x.com' }}
          next={null}
        />,
      );
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText(/a@x\.com/)).toBeInTheDocument();
    });
  });
});
