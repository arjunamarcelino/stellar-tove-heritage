import type { RfqDetailResult } from '@/lib/types/api';

// The buyer accept surface's gate verdict (TOV-178 / FR-06.04). A pure function of the viewer's signed-in state
// and the RFQ-detail read outcome — mirrors quoteGateVerdict/bidGateVerdict so the Server Component dispatcher
// stays a thin switch (and this stays unit-testable). NOTE the read is OWNER-SCOPED backend-side: a non-creator
// gets a 404, so there is no separate "not-buyer" verdict — it collapses into 'not-found' (no existence oracle).
export type RfqDetailVerdict =
  | { kind: 'gate' } // anonymous or session-expired → sign-in
  | { kind: 'not-found' } // missing OR not yours (owner-scoped 404)
  | { kind: 'load-error' } // transient read failure → retry
  | { kind: 'panel' }; // the accept flow renders

export function rfqDetailGateVerdict(args: {
  isSignedIn: boolean;
  result: RfqDetailResult;
}): RfqDetailVerdict {
  if (!args.isSignedIn) return { kind: 'gate' };
  if (args.result.status === 'success') return { kind: 'panel' };
  if (args.result.code === 'SESSION_EXPIRED') return { kind: 'gate' };
  if (args.result.code === 'RFQ_NOT_FOUND') return { kind: 'not-found' };
  return { kind: 'load-error' };
}
