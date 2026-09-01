'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import HoldingRow from '@/components/dashboard/HoldingRow';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';
import { browseArtworksHref } from '@/lib/holdings/format';
import { refreshHoldingsAction } from '@/app/actions/holdings';
import type { HoldingsResult } from '@/lib/types/api';

// Client widget for "Your fractions". Hydrates with the SSR `initial` result and switches over the
// discriminated union: rows / empty / error+retry. One-shot read — the only client request is a manual Retry
// (the refreshHoldingsAction server action), kept single-flight by a synchronous inFlightRef lock (so there's
// no out-of-order response to reconcile). Retry originates only from the error state, so a failed refresh can
// never clobber good rows.
export default function HoldingsWidget({ initial }: { initial: HoldingsResult }) {
  const [result, setResult] = useState<HoldingsResult>(initial);
  const [isPending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Liveness: the retry transition awaits, and useRouter()/setState outlive this component. Without this
  // guard a slow retry that resolves SESSION_EXPIRED after the user navigated away would run
  // router.replace('/login') and teleport them off the page they intentionally opened.
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );
  // Synchronous single-flight lock — independent of render timing (a stale-closure isPending could let a
  // held-Enter / AT activation burst double-enter). isPending stays for the button's visual/aria-busy state.
  const inFlightRef = useRef(false);

  function retry() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        const next = await refreshHoldingsAction();
        if (!aliveRef.current) return; // unmounted mid-flight → don't touch state or the router
        if (next.status === 'error' && next.code === 'SESSION_EXPIRED') {
          setAnnounce(''); // don't leave an error queued to speak on /login
          router.replace('/login');
          return;
        }
        setResult(next);
        if (next.status === 'success') {
          const n = next.holdings.length;
          const msg =
            n === 0
              ? 'You have no fractions.'
              : `${n} ${n === 1 ? 'fraction' : 'fractions'} loaded.`;
          // The Retry button just unmounted — move focus to the heading (not stranded on <body>), then
          // announce a frame later so the SR speech queue drains in order (focus otherwise preempts a
          // polite announcement queued in the same commit).
          headingRef.current?.focus();
          requestAnimationFrame(() => {
            if (aliveRef.current) setAnnounce(msg);
          });
        } else {
          // Reuse the curated error copy shown visually rather than duplicating a second string.
          setAnnounce(next.message);
        }
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  let body: ReactNode;

  if (result.status === 'error') {
    body = (
      <div className={ERROR_CLASS}>
        <p>{result.message}</p>
        <button
          type="button"
          onClick={retry}
          aria-disabled={isPending}
          aria-busy={isPending}
          className={`${MUTED_LINK} mt-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        >
          {isPending ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  } else if (result.status === 'success') {
    const { holdings, droppedCount } = result;
    if (holdings.length === 0 && droppedCount === 0) {
      body = (
        <div className="rounded-md border border-charcoal/15 bg-charcoal/5 p-6 text-sm text-charcoal">
          <p>You don’t hold any fractions yet — browse artworks.</p>
          <Link href={browseArtworksHref()} className={`${PRIMARY_BUTTON} mt-4`}>
            Browse artworks
          </Link>
        </div>
      );
    } else {
      body = (
        <div className="space-y-4">
          {droppedCount > 0 ? (
            <p className="rounded-md border border-ochre/40 bg-ochre/10 p-3 text-sm text-umber">
              {droppedCount} {droppedCount === 1 ? 'holding' : 'holdings'} couldn’t be shown.
            </p>
          ) : null}
          {holdings.length > 0 ? (
            <ul role="list" className="divide-y divide-charcoal/10">
              {holdings.map((holding) => (
                <HoldingRow key={holding.tokenContract} holding={holding} />
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
  } else {
    // Exhaustiveness guard: a new HoldingsResult variant fails to compile here instead of silently
    // rendering as rows.
    const _exhaustive: never = result;
    throw new Error(`unreachable holdings result: ${String(_exhaustive)}`);
  }

  return (
    <section aria-labelledby="your-fractions-heading">
      <h2
        id="your-fractions-heading"
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl text-charcoal"
      >
        Your fractions
      </h2>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="mt-4">{body}</div>
    </section>
  );
}
