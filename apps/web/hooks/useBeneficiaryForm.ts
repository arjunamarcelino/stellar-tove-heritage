'use client';

import { useEffect, useRef, useState } from 'react';
import type { Beneficiary, BeneficiaryNotice } from '@/lib/types/api';
import {
  type BeneficiaryFormValues,
  beneficiaryToFormValues,
  isBeneficiaryFormValid,
  normalizeBeneficiaryValues,
  EMPTY_BENEFICIARY_FORM,
} from '@/lib/beneficiary/schemas';
import { BENEFICIARY_MESSAGES } from '@/lib/beneficiary/beneficiaryMessages';
import { setBeneficiaryAction, removeBeneficiaryAction } from '@/app/actions/beneficiary';

export type BeneficiaryFormStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseBeneficiaryFormReturn {
  values: BeneficiaryFormValues;
  setValue: (field: keyof BeneficiaryFormValues, value: string) => void;
  baseline: BeneficiaryFormValues;
  // Whether a beneficiary is currently designated (derived from the hook's own snapshot — the single source
  // of truth, so the view can't disagree with it). Updated automatically by the save/remove echo.
  exists: boolean;
  dirty: boolean;
  canSave: boolean;
  status: BeneficiaryFormStatus;
  errorMessage: string | null;
  save: () => Promise<void>;
  remove: () => Promise<void>;
  discard: () => void;
}

export interface UseBeneficiaryFormOptions {
  // The write echo's `notice` is passed through so the caller can refresh the KYC banner from the latest
  // server truth (rather than the stale SSR-seeded prop).
  onSaved: (notice: BeneficiaryNotice | null) => void;
  onRemoved: (notice: BeneficiaryNotice | null) => void;
  onSessionExpired: () => void;
}

// Owns the editable beneficiary-designation form (TOV-46 / FR-01.10). Unlike useProfileForm this is a
// FULL-REPLACE write (not a partial patch), it seeds from a nullable initial (null = empty create state),
// and it exposes both a `baseline` (for the confirm-modal diff) and a `remove()` action. On a successful
// save the snapshot is re-seeded from the SERVER-echoed beneficiary (never the local values) so the form
// re-seeds from the authority and lands clean. A busyRef guards double-submit; a cancelledRef drops
// post-unmount setState. PII is never persisted to any web storage (kept in React state only).
export function useBeneficiaryForm(
  initial: Beneficiary | null,
  opts: UseBeneficiaryFormOptions,
): UseBeneficiaryFormReturn {
  // Mount-seeded and thereafter owned client-side (re-seeded from the save/remove echo). A later change to
  // the `initial` prop is NOT reconciled — the save/remove round-trip is the only baseline update path.
  const [snapshot, setSnapshot] = useState<Beneficiary | null>(initial);
  const [values, setValues] = useState<BeneficiaryFormValues>(() =>
    initial ? beneficiaryToFormValues(initial) : EMPTY_BENEFICIARY_FORM,
  );
  const [status, setStatus] = useState<BeneficiaryFormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const exists = snapshot !== null;
  const baseline: BeneficiaryFormValues = snapshot
    ? beneficiaryToFormValues(snapshot)
    : EMPTY_BENEFICIARY_FORM;

  // Diff against the baseline using compare-only normalization — never buildBeneficiaryBody (it .parse()s
  // and throws in the empty create state).
  const dirty =
    JSON.stringify(normalizeBeneficiaryValues(values)) !==
    JSON.stringify(normalizeBeneficiaryValues(baseline));
  const canSave = dirty && isBeneficiaryFormValid(values) && status !== 'saving';

  function setValue(field: keyof BeneficiaryFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Editing anything returns the form to a neutral state (inline field errors are derived by the form
    // itself from the current values — see beneficiaryFieldError).
    setStatus('idle');
    setErrorMessage(null);
  }

  async function save() {
    if (busyRef.current) return;
    if (!canSave) return; // covers not-dirty + invalid

    busyRef.current = true;
    setStatus('saving');
    setErrorMessage(null);
    try {
      const result = await setBeneficiaryAction(values);
      if (cancelledRef.current) return;

      if (result.status === 'success') {
        // Server-echo baseline: re-seed from the returned beneficiary so the form is authoritative + clean.
        // A successful set always echoes a row; guard the null (only reachable post-delete) into EMPTY.
        if (result.beneficiary) {
          setSnapshot(result.beneficiary);
          setValues(beneficiaryToFormValues(result.beneficiary));
        } else {
          setSnapshot(null);
          setValues(EMPTY_BENEFICIARY_FORM);
        }
        setErrorMessage(null);
        setStatus('saved');
        opts.onSaved(result.notice);
        return;
      }

      if (result.code === 'SESSION_EXPIRED') {
        setStatus('idle');
        opts.onSessionExpired();
        return;
      }

      if (result.code === 'VALIDATION_FAILED') {
        // Backend gives no per-field map for the write path — surface a form-level banner.
        setErrorMessage(BENEFICIARY_MESSAGES.VALIDATION_FAILED);
        setStatus('error');
        return;
      }

      setErrorMessage(BENEFICIARY_MESSAGES[result.code]);
      setStatus('error');
    } finally {
      busyRef.current = false;
    }
  }

  async function remove() {
    if (busyRef.current) return;

    busyRef.current = true;
    setStatus('saving');
    setErrorMessage(null);
    try {
      const result = await removeBeneficiaryAction();
      if (cancelledRef.current) return;

      if (result.status === 'success') {
        setSnapshot(null);
        setValues(EMPTY_BENEFICIARY_FORM);
        setErrorMessage(null);
        setStatus('saved');
        opts.onRemoved(result.notice);
        return;
      }

      if (result.code === 'SESSION_EXPIRED') {
        setStatus('idle');
        opts.onSessionExpired();
        return;
      }

      setErrorMessage(BENEFICIARY_MESSAGES[result.code]);
      setStatus('error');
    } finally {
      busyRef.current = false;
    }
  }

  function discard() {
    setValues(baseline);
    setErrorMessage(null);
    setStatus('idle');
  }

  return {
    values,
    setValue,
    baseline,
    exists,
    dirty,
    canSave,
    status,
    errorMessage,
    save,
    remove,
    discard,
  };
}
