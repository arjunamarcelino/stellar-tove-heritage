import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CharCounter from '@/components/profile/CharCounter';

describe('CharCounter', () => {
  it('renders the UTF-16 length over max', () => {
    render(<CharCounter value="hello" max={300} />);
    expect(screen.getByText('5 / 300')).toBeInTheDocument();
  });

  it('counts an emoji as 2 (UTF-16 code units)', () => {
    render(<CharCounter value="😀" max={300} />);
    expect(screen.getByText('2 / 300')).toBeInTheDocument();
  });

  it('is normal below the warn threshold (269/300)', () => {
    render(<CharCounter value={'a'.repeat(269)} max={300} />);
    const counter = screen.getByText('269 / 300');
    expect(counter.className).toContain('text-charcoal/60');
    expect(counter.className).not.toContain('text-ochre');
  });

  it('switches to the warning tone at the threshold (270/300)', () => {
    render(<CharCounter value={'a'.repeat(270)} max={300} />);
    const counter = screen.getByText('270 / 300');
    expect(counter.className).toContain('text-ochre');
  });

  it('switches to the error tone over the limit (301/300)', () => {
    render(<CharCounter value={'a'.repeat(301)} max={300} />);
    const counter = screen.getByText('301 / 300');
    expect(counter.className).toContain('text-sienna');
  });

  it('announces only on a zone crossing, not on every keystroke', () => {
    const { rerender } = render(<CharCounter value={'a'.repeat(10)} max={300} />);
    const region = screen.getByRole('status');
    // Initial render inside the normal zone: nothing announced yet.
    expect(region).toHaveTextContent('');

    // Still normal — no crossing, still silent.
    rerender(<CharCounter value={'a'.repeat(20)} max={300} />);
    expect(region).toHaveTextContent('');

    // Cross normal → warn: announce.
    rerender(<CharCounter value={'a'.repeat(270)} max={300} />);
    expect(region.textContent).toMatch(/approaching/i);
    const warnText = region.textContent;

    // Stay in warn — the announcement must not change (no re-announce per keystroke).
    rerender(<CharCounter value={'a'.repeat(280)} max={300} />);
    expect(region.textContent).toBe(warnText);

    // Cross warn → over: announce the over-limit message.
    rerender(<CharCounter value={'a'.repeat(305)} max={300} />);
    expect(region.textContent).toMatch(/over the 300 limit/i);
  });
});
