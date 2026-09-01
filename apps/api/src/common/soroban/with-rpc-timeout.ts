/**
 * Race a Soroban/Stellar RPC call against a timeout so a hung request can't pin a worker (the SDK has no
 * AbortController, so the underlying request isn't cancelled — only abandoned). The losing `promise` is
 * pre-`.catch`ed so its later rejection never surfaces as an `unhandledRejection` after the timeout wins,
 * and the timer is always cleared. Extracted from the four Soroban adapters (relayer, fraction-factory,
 * kyc-allowlist, fraction-read) that each carried an identical private copy (TOV-237 review todo 250).
 *
 * @param tag  short service label for the timeout message (e.g. 'relayer', 'fraction read')
 * @param label operation label (e.g. 'simulate.balance')
 */
export function withRpcTimeout<T>(
  tag: string,
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${tag} RPC timed out after ${timeoutMs}ms: ${label}`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
