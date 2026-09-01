'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { WhitelistStatus, WhitelistStatusResult } from '@/lib/types/api';
import { SITE_CONFIG } from '@/lib/constants';
import { estimatedDecisionDate, formatWhitelistDate, isPastDue } from '@/lib/kyc/whitelistSla';
import { useWhitelistStatusPolling } from '@/hooks/useWhitelistStatusPolling';
import {
  WHITELIST_CARD_BASE,
  WHITELIST_CARD_NEUTRAL,
  WHITELIST_CARD_SUCCESS,
  WHITELIST_CARD_WARNING,
  WHITELIST_CARD_DESTRUCTIVE,
  WHITELIST_SUPPORT_LINK,
} from '@/components/kyc/constants';

// FR-01.08 whitelist status card. Renders the five whitelist states with per-state treatment and, while
// pending_review, polls (via the hook) so a backend decision lands live. Presentational: all copy is
// curated (no raw backend strings), dates are deterministic (SSR↔client parity), and semantics ride on
// icon + heading, never colour alone.

const ICON_CLASS = 'mt-0.5 h-5 w-5 shrink-0';

function CheckIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
function RevokedIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// Per-state a11y, co-located so the two facets can't silently fork: `announce` is the polite sr-only text;
// `alert` marks destructive states that are announced via role="alert" on the VISIBLE card instead — so
// their `announce` is '' to avoid a double announcement. Flipping one without the other is visible right here.
const WHITELIST_STATE_A11Y: Record<WhitelistStatus, { announce: string; alert: boolean }> = {
  not_submitted: { announce: 'You are not yet whitelisted.', alert: false },
  pending_review: { announce: 'Your whitelist review is pending.', alert: false },
  whitelisted: { announce: 'You are now whitelisted.', alert: false },
  frozen: { announce: '', alert: true },
  removed: { announce: '', alert: true },
};

function liveAnnouncement(result: WhitelistStatusResult): string {
  return result.status === 'success'
    ? WHITELIST_STATE_A11Y[result.data.status].announce
    : 'Whitelist status is temporarily unavailable.';
}

function alertRole(status: WhitelistStatus): 'alert' | undefined {
  return WHITELIST_STATE_A11Y[status].alert ? 'alert' : undefined;
}

function CardShell({
  tone,
  icon,
  heading,
  children,
  role,
}: {
  tone: string;
  icon: ReactNode;
  heading: string;
  children: ReactNode;
  role?: 'alert';
}) {
  return (
    <div className={`${WHITELIST_CARD_BASE} ${tone}`} role={role}>
      {icon}
      <div className="space-y-1">
        <p className="font-heading text-base">{heading}</p>
        <div className="text-sm text-current/80">{children}</div>
      </div>
    </div>
  );
}

export default function WhitelistStatusCard({ initial }: { initial: WhitelistStatusResult }) {
  const { result, degraded, retry } = useWhitelistStatusPolling(initial);

  // Real clock only after mount — keeps the SSR/hydration render deterministic (past-due can't differ
  // between server and first client paint). Reading the clock must happen post-mount (not in render), so
  // this one-time setState in an effect is intentional (same rationale as useKycSubmission's restore).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setNowMs(Date.now());
  }, []);

  const supportLink = (
    <a href={`mailto:${SITE_CONFIG.supportEmail}`} className={WHITELIST_SUPPORT_LINK}>
      contact support
    </a>
  );

  let card: ReactNode;

  if (result.status === 'error') {
    card = (
      <CardShell tone={WHITELIST_CARD_NEUTRAL} icon={<InfoIcon />} heading="Status unavailable">
        <p>{result.message}</p>
        {degraded && (
          <button type="button" onClick={retry} className={`mt-1 ${WHITELIST_SUPPORT_LINK}`}>
            Retry
          </button>
        )}
      </CardShell>
    );
  } else {
    const data = result.data;
    switch (data.status) {
      case 'not_submitted':
        card = (
          <CardShell
            tone={WHITELIST_CARD_NEUTRAL}
            icon={<InfoIcon />}
            heading="Not yet whitelisted"
          >
            <p>Complete the identity verification steps below to get whitelisted.</p>
          </CardShell>
        );
        break;
      case 'pending_review': {
        const estimate = estimatedDecisionDate(data.lastSubmissionAt);
        const formatted = formatWhitelistDate(estimate);
        const pastDue = nowMs !== null && isPastDue(estimate, nowMs);
        card = (
          <CardShell tone={WHITELIST_CARD_NEUTRAL} icon={<ClockIcon />} heading="Pending review">
            {!formatted ? (
              <p>We’re reviewing your submission.</p>
            ) : pastDue ? (
              <p>We’re reviewing your submission — a decision is expected shortly.</p>
            ) : (
              <p>Estimated decision by {formatted}.</p>
            )}
          </CardShell>
        );
        break;
      }
      case 'whitelisted': {
        const on = formatWhitelistDate(data.whitelistedAt);
        card = (
          <CardShell tone={WHITELIST_CARD_SUCCESS} icon={<CheckIcon />} heading="Whitelisted">
            <p>You’re cleared to invest on Tove.{on ? ` Verified on ${on}.` : ''}</p>
          </CardShell>
        );
        break;
      }
      case 'frozen':
        card = (
          <CardShell
            tone={WHITELIST_CARD_WARNING}
            icon={<WarningIcon />}
            heading="Verification on hold"
            role={alertRole(data.status)}
          >
            <p>
              {data.reasonCopy} If you think this is a mistake, {supportLink}.
            </p>
          </CardShell>
        );
        break;
      case 'removed':
        card = (
          <CardShell
            tone={WHITELIST_CARD_DESTRUCTIVE}
            icon={<RevokedIcon />}
            heading="Verification revoked"
            role={alertRole(data.status)}
          >
            <p>
              {data.reasonCopy} To restore access, {supportLink}.
            </p>
          </CardShell>
        );
        break;
    }
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement(result)}
      </p>
      {card}
    </div>
  );
}
