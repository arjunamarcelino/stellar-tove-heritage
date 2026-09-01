import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import BeneficiarySummary from '@/components/beneficiary/BeneficiarySummary';
import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';

const PK = Keypair.random().publicKey();

const FULL: BeneficiaryFormValues = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: PK,
  relationship: 'spouse',
  notes: 'Longtime partner',
};

const MINIMAL: BeneficiaryFormValues = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: '',
  relationship: '',
  notes: '',
};

describe('BeneficiarySummary', () => {
  it('renders name and email', () => {
    render(<BeneficiarySummary values={MINIMAL} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders relationship, a truncated font-mono Stellar key, and notes when present', () => {
    render(<BeneficiarySummary values={FULL} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('spouse')).toBeInTheDocument();
    expect(screen.getByText('Longtime partner')).toBeInTheDocument();

    const truncated = `${PK.slice(0, 6)}…${PK.slice(-6)}`;
    const stellarEl = screen.getByText(truncated);
    expect(stellarEl).toBeInTheDocument();
    expect(stellarEl).toHaveClass('font-mono');
    // The full untruncated key is never rendered in the read-only summary.
    expect(screen.queryByText(PK)).toBeNull();
  });

  it('hides the optional rows when their values are empty', () => {
    render(<BeneficiarySummary values={MINIMAL} onUpdate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByText('Relationship')).toBeNull();
    expect(screen.queryByText('Stellar address')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('calls onUpdate when Update is clicked', () => {
    const onUpdate = vi.fn();
    render(<BeneficiarySummary values={MINIMAL} onUpdate={onUpdate} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls onRemove when Remove is clicked', () => {
    const onRemove = vi.fn();
    render(<BeneficiarySummary values={MINIMAL} onUpdate={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders an untrusted name as literal text (no injected script element)', () => {
    const { container } = render(
      <BeneficiarySummary
        values={{ ...MINIMAL, name: '<script>alert(1)</script>' }}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('clamps a notes value longer than 280 chars with an ellipsis', () => {
    const longNotes = 'a'.repeat(300);
    const { container } = render(
      <BeneficiarySummary
        values={{ ...MINIMAL, notes: longNotes }}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // The full 300-char value is not rendered in full…
    expect(screen.queryByText(longNotes)).toBeNull();
    // …and the clamp appends an ellipsis.
    expect(container.textContent).toContain('…');
  });
});
