'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Beneficiary, BeneficiaryNotice } from '@/lib/types/api';
import { useBeneficiaryForm } from '@/hooks/useBeneficiaryForm';
import Toast from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import InheritanceExplainer from '@/components/beneficiary/InheritanceExplainer';
import KycNoticeBanner from '@/components/beneficiary/KycNoticeBanner';
import BeneficiarySummary from '@/components/beneficiary/BeneficiarySummary';
import BeneficiaryForm from '@/components/beneficiary/BeneficiaryForm';
import BeneficiaryChangeSummary from '@/components/beneficiary/BeneficiaryChangeSummary';

interface Props {
  beneficiary: Beneficiary | null;
  notice: BeneficiaryNotice | null;
}

type Confirm = { kind: 'save' | 'remove' } | null;

// Client orchestrator for the beneficiary page (TOV-46 / FR-01.10). Owns the view↔edit mode, the confirm
// modal (gating EVERY write), and a parent-owned toast (mirrors ProfileSettings). The form state + save/remove
// round-trips live in useBeneficiaryForm; on success the hook's onSaved/onRemoved callbacks close the modal,
// flip the view, and raise the toast. Whether a designation is set comes from `form.exists` (the hook's own
// snapshot — single source of truth) and drives Summary vs the empty-state CTA.
export default function BeneficiarySettings({ beneficiary, notice }: Props) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // KYC banner code — seeded from the SSR read, then refreshed from each write echo so it reflects the
  // latest server truth rather than the mount-time snapshot.
  const [noticeCode, setNoticeCode] = useState<BeneficiaryNotice['code'] | null>(
    notice?.code ?? null,
  );

  const toastSeqRef = useRef(0);
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  function showToast(message: string, tone: 'success' | 'error') {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, tone });
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const goToLogin = () => router.replace('/login');

  const form = useBeneficiaryForm(beneficiary, {
    onSaved: (echoNotice) => {
      setConfirm(null);
      setEditing(false);
      setNoticeCode(echoNotice?.code ?? null);
      showToast('Beneficiary saved', 'success');
    },
    onRemoved: (echoNotice) => {
      setConfirm(null);
      setEditing(false);
      setNoticeCode(echoNotice?.code ?? null);
      showToast('Beneficiary removed', 'success');
    },
    onSessionExpired: goToLogin,
  });

  // Derived from the hook's snapshot (single source of truth) — Summary vs empty-state CTA, and the
  // create/update copy. Updates automatically from the save/remove echo.
  const exists = form.exists;
  const saving = form.status === 'saving';
  const dialogError = form.status === 'error' ? form.errorMessage : null;

  function handleConfirm() {
    if (confirm?.kind === 'remove') void form.remove();
    else void form.save();
  }

  function handleDiscard() {
    form.discard();
    setEditing(false);
  }

  return (
    <section className="mx-auto max-w-2xl space-y-8 px-6 py-16">
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-3xl text-charcoal outline-none"
        >
          Beneficiary
        </h1>
        <p className="mt-2 text-sm text-charcoal/60">
          Designate who inherits your holdings. You can update or remove this at any time.
        </p>
      </div>

      <KycNoticeBanner code={noticeCode} />
      <InheritanceExplainer />

      {editing ? (
        <BeneficiaryForm
          values={form.values}
          setValue={form.setValue}
          // The confirm modal owns the error while open (dialogError); the form shows it only once the modal
          // is closed — so a failed save never renders the same message in two places.
          errorMessage={confirm === null ? dialogError : null}
          canSave={form.canSave}
          saving={saving}
          dirty={form.dirty}
          submitLabel={exists ? 'Save changes' : 'Save beneficiary'}
          onSubmit={() => setConfirm({ kind: 'save' })}
          onDiscard={handleDiscard}
        />
      ) : exists ? (
        <BeneficiarySummary
          values={form.baseline}
          onUpdate={() => setEditing(true)}
          onRemove={() => setConfirm({ kind: 'remove' })}
        />
      ) : (
        <div className="rounded-md border border-dashed border-charcoal/20 bg-white p-8 text-center">
          <p className="text-sm text-charcoal/70">You haven’t designated a beneficiary yet.</p>
          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-4`}
            onClick={() => setEditing(true)}
          >
            Add a beneficiary
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        variant={confirm?.kind === 'remove' ? 'destructive' : 'primary'}
        title={
          confirm?.kind === 'remove'
            ? 'Remove beneficiary?'
            : exists
              ? 'Confirm changes'
              : 'Confirm beneficiary'
        }
        confirmLabel={confirm?.kind === 'remove' ? 'Remove' : 'Save'}
        busy={saving}
        error={confirm !== null ? dialogError : null}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === 'remove' ? (
          <BeneficiaryChangeSummary mode="remove" baseline={form.baseline} next={null} />
        ) : (
          <BeneficiaryChangeSummary
            mode={exists ? 'update' : 'create'}
            baseline={exists ? form.baseline : null}
            next={form.values}
          />
        )}
      </ConfirmDialog>

      <p className="sr-only" role="status" aria-live="polite">
        {saving ? 'Saving…' : ''}
      </p>

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}
    </section>
  );
}
