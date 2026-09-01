'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useKycSubmission } from '@/hooks/useKycSubmission';
import { KYC_DOCUMENTS } from '@/lib/kyc/constants';
import type { KycWizardState } from '@/lib/types/api';
import JurisdictionStep from '@/components/kyc/JurisdictionStep';
import DocumentUpload from '@/components/kyc/DocumentUpload';
import ReviewStep from '@/components/kyc/ReviewStep';
import ConfirmationView from '@/components/kyc/ConfirmationView';
import KycStatusView from '@/components/kyc/KycStatusView';
import {
  KYC_PRIMARY_BUTTON,
  KYC_SECONDARY_BUTTON,
  KYC_ERROR_CLASS,
} from '@/components/kyc/constants';

const STEPS = [
  { key: 'jurisdiction', label: 'Jurisdiction' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review' },
] as const;

function headingFor(state: KycWizardState): string {
  switch (state.status) {
    case 'jurisdiction':
      return 'Where do you live?';
    case 'documents':
      return 'Upload your documents';
    case 'review':
    case 'submitting':
      return 'Review and submit';
    case 'confirmation':
      return 'Submitted for review';
    case 'blocked':
      return state.reason === 'approved' ? 'You’re verified' : 'Submission under review';
    case 'error':
      return 'Something went wrong';
    case 'sessionExpired':
      return 'Session expired';
    default: {
      // Exhaustiveness guard: a new KycWizardState member must be handled here (compile error).
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function announce(state: KycWizardState): string {
  switch (state.status) {
    case 'jurisdiction':
      return 'Step 1 of 3: choose your country.';
    case 'documents':
      return 'Step 2 of 3: upload your four documents.';
    case 'review':
      return 'Step 3 of 3: review and submit.';
    case 'submitting':
      return 'Uploading your documents…';
    case 'confirmation':
      return 'Your documents were submitted for review.';
    case 'blocked':
      return state.reason === 'approved'
        ? 'Your identity is already verified.'
        : 'You already have a submission under review.';
    case 'error':
      return state.message;
    case 'sessionExpired':
      return 'Your session expired. Redirecting to sign in.';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

interface Props {
  statusHref: Route;
  previouslyRejected?: boolean;
}

// Client orchestrator for the KYC wizard. Owns the single focused step heading (moved to on each
// transition for screen-reader users), the polite live region, and the step indicator. On session
// expiry it navigates to /login (progress metadata is already persisted, so returning resumes the step).
export default function KycWizard({ statusHref, previouslyRejected }: Props) {
  const kyc = useKycSubmission();
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { state } = kyc;

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'sessionExpired') router.replace('/login');
  }, [state.status, router]);

  const activeIndex = STEPS.findIndex((s) => s.key === state.status);
  const allComplete = KYC_DOCUMENTS.every((d) => Boolean(kyc.files[d.docType]));

  return (
    <div className="space-y-8">
      <p className="sr-only" role="status" aria-live="polite">
        {announce(state)}
      </p>

      {activeIndex >= 0 && (
        <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === activeIndex ? 'step' : undefined}
              className={`flex items-center gap-2 ${
                i === activeIndex ? 'font-semibold text-charcoal' : 'text-charcoal/50'
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                  i <= activeIndex ? 'border-charcoal bg-charcoal text-bone' : 'border-charcoal/30'
                }`}
              >
                {i + 1}
              </span>
              <span>{s.label}</span>
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-charcoal/30">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl text-charcoal outline-none"
      >
        {headingFor(state)}
      </h2>

      {state.status === 'jurisdiction' && (
        <div className="space-y-6">
          {previouslyRejected && (
            <p role="status" className="text-sm text-umber">
              Your previous submission was rejected. Please review your documents and resubmit.
            </p>
          )}
          <JurisdictionStep
            value={kyc.jurisdiction}
            error={state.inlineError}
            onSelect={kyc.selectJurisdiction}
          />
          <button
            type="button"
            className={KYC_PRIMARY_BUTTON}
            onClick={kyc.next}
            disabled={!kyc.jurisdiction}
          >
            Continue
          </button>
        </div>
      )}

      {state.status === 'documents' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {KYC_DOCUMENTS.map((d) => (
              <DocumentUpload
                key={d.docType}
                docType={d.docType}
                label={d.label}
                hint={d.hint}
                accept={d.accept}
                capture={d.capture}
                file={kyc.files[d.docType]}
                error={state.slotError?.docType === d.docType ? state.slotError.message : undefined}
                onSelect={kyc.setDocument}
                onRemove={kyc.removeDocument}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className={KYC_SECONDARY_BUTTON} onClick={kyc.back}>
              Back
            </button>
            <button
              type="button"
              className={KYC_PRIMARY_BUTTON}
              onClick={kyc.next}
              disabled={!allComplete}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {(state.status === 'review' || state.status === 'submitting') && (
        <ReviewStep
          jurisdiction={kyc.jurisdiction}
          files={kyc.files}
          submitting={state.status === 'submitting'}
          onBack={kyc.back}
          onSubmit={kyc.submit}
        />
      )}

      {state.status === 'error' && (
        <div className="space-y-6">
          <p role="alert" className={KYC_ERROR_CLASS}>
            {state.message}
          </p>
          <div className="flex items-center gap-3">
            <button type="button" className={KYC_SECONDARY_BUTTON} onClick={kyc.back}>
              Back to documents
            </button>
            {state.retryable && (
              <button type="button" className={KYC_PRIMARY_BUTTON} onClick={kyc.retry}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {state.status === 'confirmation' && <ConfirmationView statusHref={statusHref} />}
      {state.status === 'blocked' && (
        <KycStatusView variant={state.reason} statusHref={statusHref} />
      )}
      {state.status === 'sessionExpired' && (
        <p className="text-sm text-charcoal/70">Redirecting you to sign in…</p>
      )}
    </div>
  );
}
