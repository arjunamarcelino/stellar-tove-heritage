'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KycWizardState, KycDocType, KycSubmitResult } from '@/lib/types/api';
import { KYC_DOC_TYPES, type KycJurisdictionCode } from '@/lib/kyc/constants';
import { fileSchema, submissionSchema } from '@/lib/kyc/schemas';
import { KYC_SUBMIT_MESSAGES } from '@/lib/kyc/kycMessages';
import { isSupportedFile } from '@/lib/kyc/fileSignature';
import { saveProgress, restoreProgress, clearProgress } from '@/lib/kyc/progress';
import { submitKycAction } from '@/app/actions/kyc';

// The idempotency key binds to one exact payload and lives ONLY in this ref (direction B — never
// persisted). Minted on the first submit of a payload, invalidated (reset to {minted:false}) on any
// payload mutation, reused only for a byte-identical retry. Modeled as a discriminated union so "reuse
// the key" is reachable only from the minted branch → IDEMPOTENCY_KEY_MISMATCH is unrepresentable.
type KeyState = { minted: false } | { minted: true; key: string };

type Files = Partial<Record<KycDocType, File>>;

// Orchestrates the KYC wizard: jurisdiction → documents → review → submit. Files live in memory; only the
// non-PII jurisdiction code is persisted to localStorage (for resume). Mirrors useWalletAdd/useWalletExport:
// a discriminated state machine, busyRef (double-submit guard) and cancelledRef (post-unmount setState
// guard) armed by the hook itself.
export function useKycSubmission() {
  const [state, setState] = useState<KycWizardState>({ status: 'jurisdiction' });
  const stateRef = useRef<KycWizardState>(state);
  const [jurisdiction, setJurisdiction] = useState<KycJurisdictionCode | null>(null);
  const jurisdictionRef = useRef<KycJurisdictionCode | null>(null);
  const [files, setFilesState] = useState<Files>({});
  const filesRef = useRef<Files>({});
  const keyRef = useRef<KeyState>({ minted: false });
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  function setStateAndRef(next: KycWizardState) {
    stateRef.current = next;
    setState(next);
  }

  function setFilesAndRef(next: Files) {
    filesRef.current = next;
    setFilesState(next);
  }

  // Persist only the jurisdiction (direction B) — no step/filled-slot data (todo 122).
  const persist = useCallback(() => {
    saveProgress({ jurisdiction: jurisdictionRef.current });
  }, []);

  // Restore non-PII progress on mount. Only the jurisdiction is persisted; files can't be restored, so a
  // returning user lands on the documents step with their jurisdiction intact and re-selects files (AC:
  // jurisdiction restored, files re-selected). Arms the unmount guard.
  useEffect(() => {
    cancelledRef.current = false;
    const saved = restoreProgress();
    if (saved?.jurisdiction) {
      jurisdictionRef.current = saved.jurisdiction;
      // Reading a client-only store must happen post-mount (not in render / a lazy initializer) to avoid
      // an SSR↔client hydration mismatch, so this one-time setState in an effect is intentional.
      /* eslint-disable react-hooks/set-state-in-effect */
      setJurisdiction(saved.jurisdiction);
      setStateAndRef({ status: 'documents' });
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const selectJurisdiction = useCallback(
    (code: KycJurisdictionCode) => {
      jurisdictionRef.current = code;
      keyRef.current = { minted: false }; // payload changed → invalidate key
      setJurisdiction(code);
      persist();
    },
    [persist],
  );

  const setDocument = useCallback(
    async (docType: KycDocType, file: File) => {
      // Sync validation first (size / non-empty / declared type).
      const parsed = fileSchema.safeParse(file);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'That file can’t be used.';
        setStateAndRef({ status: 'documents', slotError: { docType, message } });
        return;
      }
      // Async magic-byte cross-check (renamed/spoofed extension).
      const supported = await isSupportedFile(file);
      if (cancelledRef.current) return;
      if (!supported) {
        setStateAndRef({
          status: 'documents',
          slotError: { docType, message: 'That file doesn’t look like a JPEG, PNG or PDF.' },
        });
        return;
      }
      keyRef.current = { minted: false }; // payload changed → invalidate key
      setFilesAndRef({ ...filesRef.current, [docType]: file });
      setStateAndRef({ status: 'documents' }); // clears any slot error
      persist();
    },
    [persist],
  );

  const removeDocument = useCallback(
    (docType: KycDocType) => {
      keyRef.current = { minted: false };
      const next = { ...filesRef.current };
      delete next[docType];
      setFilesAndRef(next);
      setStateAndRef({ status: 'documents' });
      persist();
    },
    [persist],
  );

  const next = useCallback(() => {
    const s = stateRef.current;
    if (s.status === 'jurisdiction') {
      if (!jurisdictionRef.current) {
        setStateAndRef({ status: 'jurisdiction', inlineError: 'Please choose your country.' });
        return;
      }
      setStateAndRef({ status: 'documents' });
      persist();
    } else if (s.status === 'documents') {
      const complete = KYC_DOC_TYPES.every((d) => Boolean(filesRef.current[d]));
      if (!complete) return; // Continue is UI-gated; this is a backstop
      setStateAndRef({ status: 'review' });
      persist();
    }
  }, [persist]);

  const back = useCallback(() => {
    const s = stateRef.current;
    if (s.status === 'documents') {
      setStateAndRef({ status: 'jurisdiction' });
      persist();
    } else if (s.status === 'review' || s.status === 'error') {
      setStateAndRef({ status: 'documents' });
      persist();
    }
  }, [persist]);

  // Route the submit result to the right state. On success, clear the key + progress; a jurisdiction
  // rejection resets the key (jurisdiction must change); already-pending/approved → blocked (clear
  // progress); session expiry → sessionExpired (the component navigates); a mismatch mints a fresh key;
  // rate-limit is not retryable; everything else is a retryable error.
  const routeResult = useCallback((result: KycSubmitResult) => {
    if (result.status === 'success') {
      keyRef.current = { minted: false };
      clearProgress();
      setStateAndRef({ status: 'confirmation', submissionId: result.submissionId });
      return;
    }
    const { code, message } = result;
    switch (code) {
      case 'JURISDICTION_NOT_ELIGIBLE':
        keyRef.current = { minted: false };
        setStateAndRef({ status: 'jurisdiction', inlineError: message });
        return;
      case 'KYC_ALREADY_PENDING':
        clearProgress();
        setStateAndRef({ status: 'blocked', reason: 'pending' });
        return;
      case 'KYC_ALREADY_APPROVED':
        clearProgress();
        setStateAndRef({ status: 'blocked', reason: 'approved' });
        return;
      case 'SESSION_EXPIRED':
        setStateAndRef({ status: 'sessionExpired' });
        return;
      case 'IDEMPOTENCY_KEY_MISMATCH':
        keyRef.current = { minted: false }; // mint fresh on the next submit
        setStateAndRef({ status: 'error', code, message, retryable: true });
        return;
      case 'IDEMPOTENCY_KEY_IN_FLIGHT':
        // The same submission is still processing on the backend; an immediate retry just loops back into
        // it. Treat it as "in progress" and route to the status view — its Check-status link re-runs the
        // server-side gate (which will show pending_review once the in-flight submit lands).
        clearProgress();
        setStateAndRef({ status: 'blocked', reason: 'pending' });
        return;
      case 'RATE_LIMITED':
        setStateAndRef({ status: 'error', code, message, retryable: false });
        return;
      default:
        setStateAndRef({ status: 'error', code, message, retryable: true });
        return;
    }
  }, []);

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    const parsed = submissionSchema.safeParse({
      claimedJurisdiction: jurisdictionRef.current,
      gov_id_front: filesRef.current.gov_id_front,
      gov_id_back: filesRef.current.gov_id_back,
      proof_of_address: filesRef.current.proof_of_address,
      selfie: filesRef.current.selfie,
    });
    if (!parsed.success) {
      setStateAndRef({ status: 'documents' }); // backstop; Submit is UI-gated
      return;
    }

    busyRef.current = true;
    try {
      // Mint the key once, bound to this payload. crypto.randomUUID() throws outside a secure context →
      // surface as an error rather than leaving the machine stuck.
      let keyState = keyRef.current;
      try {
        if (!keyState.minted) {
          keyState = { minted: true, key: crypto.randomUUID() };
          keyRef.current = keyState;
        }
      } catch {
        setStateAndRef({
          status: 'error',
          code: 'SERVER_ERROR',
          message: KYC_SUBMIT_MESSAGES.SERVER_ERROR,
          retryable: true,
        });
        return;
      }

      setStateAndRef({ status: 'submitting' });

      const fd = new FormData();
      fd.set('idempotencyKey', keyState.key);
      fd.set('claimedJurisdiction', parsed.data.claimedJurisdiction);
      for (const d of KYC_DOC_TYPES) fd.set(d, parsed.data[d]);

      const result = await submitKycAction(fd);
      if (cancelledRef.current) return;
      routeResult(result);
    } finally {
      busyRef.current = false;
    }
  }, [routeResult]);

  // Retry a retryable error: return to review so the user can resubmit. A byte-identical retry reuses the
  // key (replays the original 202); a mismatch already reset the key, so it mints fresh.
  const retry = useCallback(() => {
    if (stateRef.current.status !== 'error') return;
    setStateAndRef({ status: 'review' });
  }, []);

  const reset = useCallback(() => {
    busyRef.current = false;
    keyRef.current = { minted: false };
    jurisdictionRef.current = null;
    filesRef.current = {};
    setJurisdiction(null);
    setFilesState({});
    clearProgress();
    setStateAndRef({ status: 'jurisdiction' });
  }, []);

  return {
    state,
    jurisdiction,
    files,
    selectJurisdiction,
    setDocument,
    removeDocument,
    next,
    back,
    submit,
    retry,
    reset,
  } as const;
}
