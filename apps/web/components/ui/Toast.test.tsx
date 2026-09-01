import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Toast from '@/components/ui/Toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('announces a success politely (role=status, aria-live=polite)', () => {
    render(<Toast message="Profile saved." tone="success" onDismiss={vi.fn()} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Profile saved.');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('announces an error assertively (role=alert, aria-live=assertive)', () => {
    render(<Toast message="Something went wrong." tone="error" onDismiss={vi.fn()} />);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('Something went wrong.');
    expect(el).toHaveAttribute('aria-live', 'assertive');
  });

  it('auto-dismisses after ~4s by calling onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Profile saved." tone="success" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses manually via the button', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Profile saved." tone="success" onDismiss={onDismiss} />);
    act(() => {
      screen.getByRole('button', { name: /dismiss/i }).click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears its timer on unmount (no call after unmount)', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <Toast message="Profile saved." tone="success" onDismiss={onDismiss} />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not steal focus on mount', () => {
    const before = document.activeElement;
    render(<Toast message="Profile saved." tone="success" onDismiss={vi.fn()} />);
    expect(document.activeElement).toBe(before);
  });
});
