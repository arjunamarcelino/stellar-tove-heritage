// Abortable delay — clears the timer and rejects on abort so a poll/reconcile loop unwinds immediately on
// unmount/reset instead of leaving a pending timer holding a closure. Shared by the wallet-export and
// wallet-rotation reconcile loops (extracted from the two identical copies — TOV-48 review #260).
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
