import { describe, it, expect, vi } from 'vitest';
import { runBounded } from '../../../../src/modules/fractionalization/run-bounded';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('runBounded', () => {
  it('rejects when limit < 1', async () => {
    await expect(runBounded([1], 0, (x) => Promise.resolve(x))).rejects.toThrow(RangeError);
  });

  it('maps every item and preserves input order', async () => {
    const out = await runBounded([1, 2, 3, 4, 5], 2, (x) => Promise.resolve(x * 10));
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBounded(Array.from({ length: 12 }, (_, i) => i), 3, async (x) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return x;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('fails fast on the first error and stops pulling new items', async () => {
    const started: number[] = [];
    await expect(
      runBounded([0, 1, 2, 3, 4, 5, 6, 7], 1, (x) => {
        started.push(x);
        if (x === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve(x);
      }),
    ).rejects.toThrow('boom');
    // With concurrency 1, after item 1 throws no further items are pulled.
    expect(started).toEqual([0, 1]);
  });

  it('does not emit an unhandled rejection when later tasks reject after the first', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        runBounded([0, 1, 2, 3], 4, async (x) => {
          await tick();
          throw new Error(`fail-${x}`);
        }),
      ).rejects.toThrow(/fail-/);
      await tick();
      await tick();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});
