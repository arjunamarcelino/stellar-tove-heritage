import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { offering } from '@/test/fixtures/offerings';
import type { Countdown } from '@/hooks/useCountdown';

// Drive the ticking values directly — the hook's clock/SSR-parity behaviour is covered in its own test.
const h = vi.hoisted(() => ({
  value: {
    days: 1,
    hours: 2,
    minutes: 3,
    seconds: 4,
    expired: false,
    totalMs: 93_784_000,
  } as Countdown,
}));
vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => h.value,
}));

import OfferingCountdown from '@/components/offering/OfferingCountdown';

beforeEach(() => {
  h.value = { days: 1, hours: 2, minutes: 3, seconds: 4, expired: false, totalMs: 93_784_000 };
});

describe('OfferingCountdown', () => {
  it('a live offering shows an aria-hidden segmented readout counting toward the close', () => {
    const { container } = render(<OfferingCountdown offering={offering} uiState="biddable" />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    // Segments render zero-padded, fixed-width digits (tabular-nums).
    expect(hidden).toHaveTextContent('01');
    expect(hidden).toHaveTextContent('02');
  });

  it('exposes a STATIC absolute close date as the accessible name (deterministic UTC)', () => {
    render(<OfferingCountdown offering={offering} uiState="biddable" />);
    // windowCloseAt = 2026-08-27T10:00:00Z
    expect(screen.getByText(/Closes August 27, 2026.*10:00.*UTC/)).toBeInTheDocument();
  });

  it('coming-soon counts toward the open instant with an "Opens" spoken line', () => {
    render(<OfferingCountdown offering={offering} uiState="coming-soon" />);
    // windowOpenAt = 2026-08-20T10:00:00Z
    expect(screen.getByText(/Opens August 20, 2026/)).toBeInTheDocument();
  });

  it('shows a sienna "Closing soon" label in the final 30s of a live window', () => {
    h.value = { days: 0, hours: 0, minutes: 0, seconds: 12, expired: false, totalMs: 12_000 };
    render(<OfferingCountdown offering={offering} uiState="biddable" />);
    const label = screen.getByText(/closing soon/i);
    expect(label.className).toMatch(/text-sienna/);
    expect(label.className).not.toMatch(/emerald|rose|red|green/);
  });

  it('renders nothing meaningful for a closed offering', () => {
    const { container } = render(<OfferingCountdown offering={offering} uiState="closed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing meaningful for a canceled offering', () => {
    const { container } = render(<OfferingCountdown offering={offering} uiState="canceled" />);
    expect(container).toBeEmptyDOMElement();
  });
});
