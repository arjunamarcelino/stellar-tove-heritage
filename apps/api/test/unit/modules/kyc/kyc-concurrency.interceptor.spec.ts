import { describe, it, expect } from 'vitest';
import { of, Subject } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { KycConcurrencyInterceptor } from '@modules/kyc/kyc-concurrency.interceptor';
import type { KycConfig } from '@config/kyc.config';

const ctx = {} as ExecutionContext;
const handlerOf = (obs: CallHandler['handle'] extends () => infer R ? R : never): CallHandler => ({
  handle: () => obs,
});

function gate(max: number): KycConcurrencyInterceptor {
  return new KycConcurrencyInterceptor({ maxConcurrentSubmissions: max } as KycConfig);
}

describe('KycConcurrencyInterceptor', () => {
  it('rejects with 503 once the in-flight cap is reached, and frees a slot when a request completes', () => {
    const g = gate(1);
    const pending = new Subject<unknown>();

    // First request acquires the only slot (not completed yet).
    g.intercept(ctx, handlerOf(pending.asObservable())).subscribe({ error: () => undefined });

    // Second request is over capacity → 503.
    expect(() => g.intercept(ctx, handlerOf(of('ok')))).toThrow(/capacity/i);

    // First completes → slot released.
    pending.complete();

    // A subsequent request now proceeds.
    expect(() => g.intercept(ctx, handlerOf(of('ok'))).subscribe()).not.toThrow();
  });

  it('releases the slot even when the handler errors', () => {
    const g = gate(1);
    const failing = new Subject<unknown>();
    g.intercept(ctx, handlerOf(failing.asObservable())).subscribe({ error: () => undefined });
    failing.error(new Error('boom')); // finalize runs on error too

    expect(() => g.intercept(ctx, handlerOf(of('ok'))).subscribe()).not.toThrow();
  });
});
