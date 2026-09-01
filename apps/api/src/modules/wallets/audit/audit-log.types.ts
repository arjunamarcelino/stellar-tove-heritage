/** Actor that triggered an audited event. `admin` = a backoffice operator (carries the admin `sub`). */
export type AuditActorType = 'user' | 'system' | 'admin';

/** Canonical audit-log event kinds. Export lifecycle (TOV-40) + primary-wallet changes (TOV-25). */
export const AUDIT_KIND = {
  EXPORT_REQUESTED: 'wallet.export.requested',
  EXPORT_SUBMIT: 'wallet.export.submit',
  EXPORT_CONFIRMED: 'wallet.export.confirmed',
  EXPORT_FAILED: 'wallet.export.failed',
  // TOV-25: primary settlement wallet changed (user set-primary, or auto-promote on delete).
  PRIMARY_CHANGED: 'wallet.primary.changed',
  // TOV-28: a KYC submission was accepted and moved to pending_review (encrypted documents stored).
  KYC_SUBMISSION_CREATED: 'kyc.submission.created',
  // TOV-233: per-artwork FractionToken deploy lifecycle (admin-triggered).
  ARTWORK_FRACTIONALIZATION_REQUESTED: 'artwork.fractionalization.requested',
  ARTWORK_FRACTIONALIZATION_DEPLOYED: 'artwork.fractionalization.deployed',
  ARTWORK_FRACTIONALIZATION_FAILED: 'artwork.fractionalization.failed',
  // TOV-235: on-chain KYC allowlist batch processed (admin add/remove of Collector wallets). One row per
  // batch — subject_id is the batch id (uuid); per-item wallets/results live in the payload.
  KYC_ALLOWLIST_PROCESSED: 'kyc.allowlist.processed',
  // TOV-241: an admin READ a wallet's KYC-allowlist status. subject_id is the queried wallet StrKey.
  // Access-audit for a compliance surface (who looked up whose status); written per read, fail-closed.
  KYC_ALLOWLIST_READ: 'kyc.allowlist.read',
  // TOV-152: an admin planned a primary Offering (status='planned').
  OFFERING_PLANNED: 'offering.planned',
  // TOV-154: offering multi-sig approval + escrow deploy lifecycle.
  OFFERING_APPROVAL_SIGNED: 'offering.approval.signed',
  OFFERING_APPROVAL_EXPIRED: 'offering.approval.expired',
  OFFERING_ESCROW_DEPLOYED: 'offering.escrow.deployed',
  OFFERING_ESCROW_DEPLOY_FAILED: 'offering.escrow.deploy_failed',
  OFFERING_OPENED: 'offering.opened',
  // TOV-156: primary-Offering bid submission + escrow lifecycle. subject_id is the bid uuid.
  BID_SUBMITTED: 'offering.bid.submitted',
  BID_ESCROWED: 'offering.bid.escrowed',
  BID_ESCROW_FAILED: 'offering.bid.escrow_failed',
  // TOV-158: primary-Offering bid cancel + USDC refund lifecycle. subject_id is the bid uuid.
  BID_CANCELING: 'offering.bid.canceling',
  BID_CANCELED: 'offering.bid.canceled',
  BID_CANCEL_FAILED: 'offering.bid.cancel_failed',
  // TOV-160: uniform-price clearing + settlement lifecycle. subject_id is the offering uuid.
  OFFERING_CLEARING_PREVIEWED: 'offering.clearing.previewed',
  OFFERING_CLOSED: 'offering.closed',
  OFFERING_SETTLED: 'offering.settled',
  OFFERING_SETTLE_FAILED: 'offering.settle_failed',
  // TOV-172: a whitelisted Collector created a marketplace RFQ. subject_id is the rfq uuid.
  RFQ_CREATED: 'rfq.created',
  // TOV-174: the rfq-fanout worker created the in-app notification rows for an RFQ's holders. subject_id is
  // the rfq uuid; payload carries recipientCount. Written once (gated on the completion-latch CAS win).
  RFQ_NOTIFICATIONS_FANNED_OUT: 'rfq.notifications.fanned_out',
  // TOV-175: a whitelisted holder submitted a quote (offer to sell) on an RFQ. subject_id is the quote uuid;
  // payload carries rfqId + fractionContractId + fractionCount + pricePerFractionStroops (NOT the buyer's sub).
  // Bare-resource prefix to match the sibling marketplace kinds (rfq.created, rfq.notifications.fanned_out).
  QUOTE_SUBMITTED: 'quote.submitted',
  QUOTE_AUTHORIZED: 'quote.authorized',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_SUPERSEDED: 'quote.superseded',
  QUOTE_EXPIRED: 'quote.expired',
  TRADE_SETTLED: 'trade.settled',
  TRADE_FAILED: 'trade.failed',
  // TOV-31: beneficiary designation set/update + removal. subject_id is the beneficiary row uuid;
  // payload carries { operation, changedFields } — key names only, never the beneficiary's PII.
  BENEFICIARY_SET: 'beneficiary.set',
  BENEFICIARY_REMOVED: 'beneficiary.removed',
  // TOV-33: wallet rotation holdings-transfer lifecycle. subject_id is the rotation-transfer uuid (or, for
  // the per-item confirm/fail rows, the rotation-transfer-item uuid). Distinct from the append-only
  // `registry_events` on-chain provenance (custody_transfer) — audit is the app-action log, no double-write.
  ROTATION_REQUESTED: 'wallet.rotation.requested',
  ROTATION_CONFIRMED: 'wallet.rotation.confirmed',
  ROTATION_FAILED: 'wallet.rotation.failed',
  ROTATION_COMPLETED: 'wallet.rotation.completed',
  ROTATION_CANCELED: 'wallet.rotation.canceled',
} as const;

/** The canonical audit-kind literals, derived from {@link AUDIT_KIND} so callers can't drift or typo. */
export type AuditKind = (typeof AUDIT_KIND)[keyof typeof AUDIT_KIND];

/** A new append-only audit row. `created_at` + `id` are assigned by the DB. */
export interface NewAuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  kind: AuditKind;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown> | null;
}
