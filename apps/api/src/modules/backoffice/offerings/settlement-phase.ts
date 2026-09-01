import { assertNever } from '@common/utils/assert-never';
import { Offering } from '@modules/offerings/entities/offering.entity';

/**
 * FR-05.06 settlement vocabulary (`closed → settling → settled`) surfaced as a DERIVED, read-only view of the
 * shipped `opened → subscribed → settled` state machine (TOV-165). Pure + clock-injected so it is exhaustively
 * table-testable; the backoffice read DTO is its single consumer, so it lives here (the neutral offerings root
 * is reserved for helpers with two consuming surfaces — `clearing.ts`, `offering-planning.helpers.ts`).
 *
 * `null` = not in a settlement-relevant phase (pre-close or planning/approval).
 */
export const SETTLEMENT_PHASES = ['closed', 'settling', 'settled', 'canceled'] as const;
export type SettlementPhase = (typeof SETTLEMENT_PHASES)[number] | null;

/**
 * Status is the sole discriminant (window is consulted ONLY in the `opened` arm), so there is no
 * `(status × window × settle_failed_at)` matrix to reason about and clock skew can never yield an undefined
 * cell for a `subscribed` offering. `settle_failed_at` is deliberately NOT folded in — a failed settle stays
 * `'settling'` and the DTO's separate `settleFailedAt`/`settleFailureReason` fields distinguish "wedged" from
 * "in progress". An undersubscribed offering rests at `opened`+window-closed → permanent `'closed'` (accepted;
 * its reason surfaces via `OFFERING_UNDERSUBSCRIBED` at the settle endpoint). A future `OfferingStatus` variant
 * is a COMPILE error via `assertNever` (TOV-160 #322), never a silent `null`.
 */
export function deriveSettlementPhase(o: Offering, now: Date): SettlementPhase {
  switch (o.status) {
    case 'canceled':
      return 'canceled';
    case 'settled':
      return 'settled';
    case 'subscribed':
      return 'settling';
    case 'opened':
      return now.getTime() >= o.windowCloseAt.getTime() ? 'closed' : null;
    case 'planned':
    case 'approved':
      return null;
    default:
      return assertNever(o.status);
  }
}
