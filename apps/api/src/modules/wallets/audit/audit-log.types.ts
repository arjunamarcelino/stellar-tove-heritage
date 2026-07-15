/** Actor that triggered an audited event. */
export type AuditActorType = 'user' | 'system';

/** Canonical audit-log event kinds. Export lifecycle (TOV-40) + primary-wallet changes (TOV-25). */
export const AUDIT_KIND = {
  EXPORT_REQUESTED: 'wallet.export.requested',
  EXPORT_SUBMIT: 'wallet.export.submit',
  EXPORT_CONFIRMED: 'wallet.export.confirmed',
  EXPORT_FAILED: 'wallet.export.failed',
  // TOV-25: primary settlement wallet changed (user set-primary, or auto-promote on delete).
  PRIMARY_CHANGED: 'wallet.primary.changed',
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
