'use client';

import { useHandlePicker } from '@/hooks/useHandlePicker';
import { AUTH_INPUT_CLASS, AUTH_PRIMARY_BUTTON_CLASS } from '@/components/auth/constants';
import type { HandlePickerState } from '@/lib/types/api';

// The onboarding handle picker (FR-01.05). Plain input + a `role="status"` live region (NOT a
// combobox — there's no popup/list). `aria-busy` on the status region while checking suppresses
// screen-reader announcement thrash during rapid typing; only settled verdicts are announced.
// The Continue CTA is truly disabled until the handle is `available`.

// Visual + a11y status text per machine state. `available` is the only affordance that enables Continue.
function statusView(state: HandlePickerState): { message: string; tone: 'muted' | 'good' | 'bad' } {
  switch (state.status) {
    case 'debouncing':
    case 'checking':
      return { message: 'Checking availability…', tone: 'muted' };
    case 'available':
      return { message: '✓ Available', tone: 'good' };
    case 'unavailable':
      return { message: state.message, tone: 'bad' };
    case 'invalid':
      return { message: state.message, tone: 'bad' };
    case 'error':
      return { message: state.message, tone: 'bad' };
    case 'submitting':
    case 'idle':
      return { message: '', tone: 'muted' };
  }
}

const TONE_CLASS: Record<'muted' | 'good' | 'bad', string> = {
  muted: 'text-white/50',
  good: 'text-ochre',
  bad: 'text-red-400',
};

export default function HandlePicker() {
  const { value, state, onChange, onCompositionStart, onCompositionEnd, submit } =
    useHandlePicker();

  const isAvailable = state.status === 'available';
  const isSubmitting = state.status === 'submitting';
  const isChecking = state.status === 'checking' || state.status === 'debouncing';
  const isFieldInvalid = state.status === 'invalid' || state.status === 'unavailable';
  const { message, tone } = statusView(state);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="handle" className="mb-2 block text-sm font-medium text-white/70">
        Choose your handle
      </label>

      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
        >
          @
        </span>
        <input
          id="handle"
          name="handle"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) => onCompositionEnd(event.currentTarget.value)}
          disabled={isSubmitting}
          inputMode="text"
          maxLength={24}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={isFieldInvalid}
          aria-describedby="handle-help handle-status"
          className={`${AUTH_INPUT_CLASS} pl-8`}
        />
      </div>

      <p id="handle-help" className="mt-2 text-xs text-white/50">
        Your handle is public and can’t be changed yet. 3–24 characters — letters, numbers, and . _
        -
      </p>

      <div
        id="handle-status"
        role="status"
        aria-live="polite"
        aria-busy={isChecking}
        className={`mt-1 min-h-5 text-sm ${TONE_CLASS[tone]}`}
      >
        {message}
      </div>

      <button
        type="submit"
        disabled={!isAvailable || isSubmitting}
        className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-6`}
      >
        {isSubmitting ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}
