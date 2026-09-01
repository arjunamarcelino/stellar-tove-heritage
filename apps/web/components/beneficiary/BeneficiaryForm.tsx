'use client';

import { useState } from 'react';
import CharCounter from '@/components/ui/CharCounter';
import { BENEFICIARY_FIELD_CLASS } from '@/components/beneficiary/fieldClasses';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS } from '@/components/ui/surfaces';
import { type BeneficiaryFormValues, beneficiaryFieldError } from '@/lib/beneficiary/schemas';
import {
  NAME_MAX_LENGTH,
  RELATIONSHIP_MAX_LENGTH,
  NOTES_MAX_LENGTH,
} from '@/lib/beneficiary/constants';

interface Props {
  values: BeneficiaryFormValues;
  setValue: (field: keyof BeneficiaryFormValues, value: string) => void;
  errorMessage: string | null;
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onDiscard: () => void;
}

// Controlled beneficiary form (TOV-46). Presentational: it receives values/setValue as props (the
// orchestrator owns the hook), so it is independent of the hook implementation. Per-field inline errors are
// derived from the shared `beneficiaryFieldError` helper (single source for the strings): format errors
// (email, Stellar) appear as soon as an invalid value is entered; required-empty errors (name, email)
// appear once the field is blurred. Save is disabled until the form is valid + dirty (canSave from the hook).
export default function BeneficiaryForm({
  values,
  setValue,
  errorMessage,
  canSave,
  saving,
  dirty,
  submitLabel,
  onSubmit,
  onDiscard,
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<keyof BeneficiaryFormValues, boolean>>>({});
  const markTouched = (field: keyof BeneficiaryFormValues) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const nameError = beneficiaryFieldError('name', values.name, touched.name);
  const emailError = beneficiaryFieldError('email', values.email, touched.email);
  const stellarError = beneficiaryFieldError('stellarPubkey', values.stellarPubkey);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <label htmlFor="beneficiary-name" className="mb-2 block text-sm font-medium text-charcoal">
          Name
        </label>
        <input
          id="beneficiary-name"
          type="text"
          value={values.name}
          disabled={saving}
          maxLength={NAME_MAX_LENGTH + 20}
          onChange={(e) => setValue('name', e.target.value)}
          onBlur={() => markTouched('name')}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={
            nameError
              ? 'beneficiary-name-error beneficiary-name-counter'
              : 'beneficiary-name-counter'
          }
          className={BENEFICIARY_FIELD_CLASS}
        />
        <div className="mt-1 flex items-start justify-between gap-4">
          {nameError ? (
            <p id="beneficiary-name-error" role="alert" className="text-sm text-sienna">
              {nameError}
            </p>
          ) : (
            <span />
          )}
          <CharCounter id="beneficiary-name-counter" value={values.name} max={NAME_MAX_LENGTH} />
        </div>
      </div>

      <div>
        <label htmlFor="beneficiary-email" className="mb-2 block text-sm font-medium text-charcoal">
          Email
        </label>
        <input
          id="beneficiary-email"
          type="email"
          value={values.email}
          disabled={saving}
          onChange={(e) => setValue('email', e.target.value)}
          onBlur={() => markTouched('email')}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'beneficiary-email-error' : undefined}
          className={BENEFICIARY_FIELD_CLASS}
        />
        {emailError ? (
          <p id="beneficiary-email-error" role="alert" className="mt-1 text-sm text-sienna">
            {emailError}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="beneficiary-stellar"
          className="mb-2 block text-sm font-medium text-charcoal"
        >
          Stellar address <span className="text-charcoal/50">(optional)</span>
        </label>
        <input
          id="beneficiary-stellar"
          type="text"
          value={values.stellarPubkey}
          disabled={saving}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue('stellarPubkey', e.target.value)}
          aria-invalid={stellarError ? true : undefined}
          aria-describedby={stellarError ? 'beneficiary-stellar-error' : undefined}
          className={`${BENEFICIARY_FIELD_CLASS} font-mono`}
        />
        {stellarError ? (
          <p id="beneficiary-stellar-error" role="alert" className="mt-1 text-sm text-sienna">
            {stellarError}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="beneficiary-relationship"
          className="mb-2 block text-sm font-medium text-charcoal"
        >
          Relationship <span className="text-charcoal/50">(optional)</span>
        </label>
        <input
          id="beneficiary-relationship"
          type="text"
          value={values.relationship}
          disabled={saving}
          maxLength={RELATIONSHIP_MAX_LENGTH + 20}
          onChange={(e) => setValue('relationship', e.target.value)}
          aria-describedby="beneficiary-relationship-counter"
          className={BENEFICIARY_FIELD_CLASS}
        />
        <div className="mt-1 flex justify-end">
          <CharCounter
            id="beneficiary-relationship-counter"
            value={values.relationship}
            max={RELATIONSHIP_MAX_LENGTH}
          />
        </div>
      </div>

      <div>
        <label htmlFor="beneficiary-notes" className="mb-2 block text-sm font-medium text-charcoal">
          Notes <span className="text-charcoal/50">(optional)</span>
        </label>
        <textarea
          id="beneficiary-notes"
          rows={3}
          value={values.notes}
          disabled={saving}
          maxLength={NOTES_MAX_LENGTH + 20}
          onChange={(e) => setValue('notes', e.target.value)}
          aria-describedby="beneficiary-notes-counter"
          className={BENEFICIARY_FIELD_CLASS}
        />
        <div className="mt-1 flex justify-end">
          <CharCounter id="beneficiary-notes-counter" value={values.notes} max={NOTES_MAX_LENGTH} />
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className={ERROR_CLASS}>
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={!canSave}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={onDiscard}
          disabled={!dirty || saving}
        >
          Discard
        </button>
      </div>
    </form>
  );
}
