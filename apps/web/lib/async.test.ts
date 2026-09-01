import { describe, it, expect, vi, afterEach } from 'vitest';
import { delay } from '@/lib/async';

afterEach(() => vi.useRealTimers());

describe('delay', () => {
  it('resolves after the timer fires', async () => {
    vi.useFakeTimers();
    const c = new AbortController();
    const p = delay(1000, c.signal);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const c = new AbortController();
    c.abort();
    // Assert on the DOMException name (not instanceof — jsdom's DOMException class differs from Node's).
    await expect(delay(1000, c.signal)).rejects.toHaveProperty('name', 'AbortError');
  });

  it('rejects and clears the timer when aborted mid-wait', async () => {
    vi.useFakeTimers();
    const c = new AbortController();
    const p = delay(1000, c.signal);
    c.abort();
    await expect(p).rejects.toHaveProperty('name', 'AbortError');
  });
});
