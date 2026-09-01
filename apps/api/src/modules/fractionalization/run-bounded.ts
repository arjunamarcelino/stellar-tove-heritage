/**
 * Run `fn` over `items` with at most `limit` concurrent executions, preserving input order.
 *
 * Fail-fast with **no floating rejections**: a naive `Promise.all(items.map(fn))` leaves the
 * post-first-error rejections detached from any `await`, which Node surfaces as `unhandledRejection`
 * (and can crash the process under `--unhandled-rejections=strict`). Here every task is awaited inside a
 * worker that owns a `try/catch`, so nothing floats; on the first error workers stop pulling new items
 * (`!failed`) and the in-flight ones drain before the captured error is re-thrown.
 */
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError('runBounded: limit must be >= 1');
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (cursor < items.length && !failed) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
  };

  const pool = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  if (failed) throw firstError;
  return results;
}
