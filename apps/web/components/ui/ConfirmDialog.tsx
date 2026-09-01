'use client';

import { useEffect, useId, useRef } from 'react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';

// Destructive confirm accent — light settings surface (sienna is the brand's single destructive tone). Kept
// inline here rather than a shared constant: it's the only sienna-filled button in the app so far.
const DESTRUCTIVE_BUTTON =
  'inline-flex items-center justify-center rounded-sm bg-sienna px-6 py-3 text-sm font-semibold ' +
  'text-bone hover:bg-sienna/90 disabled:opacity-50';

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  variant: 'primary' | 'destructive';
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

// Controlled (dumb) confirmation dialog on the native <dialog> element for the light settings surface
// (TOV-46). The parent owns `open`/`busy`/`error`; this only reflects them. Driven imperatively (showModal /
// close) — never the `open` attribute — so it gets the top-layer + backdrop + focus-trap the platform gives
// showModal(). role is alertdialog for destructive (a11y: interrupt), plain dialog for a routine confirm.
export default function ConfirmDialog({
  open,
  title,
  confirmLabel,
  variant,
  busy,
  error,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The element that had focus before the dialog opened, so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const isDestructive = variant === 'destructive';
  // Mirror the current variant into a ref so the open effect can read it WITHOUT depending on it (a variant
  // flip while open must not close+reopen the dialog). Synced in an effect — never mutated during render.
  const isDestructiveRef = useRef(isDestructive);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    isDestructiveRef.current = isDestructive;
  }, [isDestructive]);

  // Open/close is driven ONLY by `open`. On close, focus is restored to the element that opened the dialog.
  // This effect intentionally has NO teardown-close: a cleanup that closed the dialog would run BEFORE the
  // open→false branch on the next render and swallow the focus restore (the original bug). Unmount teardown
  // lives in the mount-only effect below.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;

    if (open) {
      if (!dlg.open) {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        dlg.showModal();
        // Focus the least-destructive control (Cancel when destructive, Confirm otherwise) rather than
        // relying on autoFocus, which showModal's own focus handling can race.
        (isDestructiveRef.current ? cancelRef : confirmRef).current?.focus();
      }
    } else if (dlg.open) {
      dlg.close();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
  }, [open]);

  // Unmount teardown: close a still-open dialog so it can't linger on the top layer. Mount-only, so it never
  // pre-empts the open→false focus restore above. The `.open` guard makes the Strict-Mode double-invoke safe.
  useEffect(() => {
    const dlg = dialogRef.current; // copy the ref so the cleanup doesn't read a possibly-changed ref
    return () => {
      if (dlg?.open) dlg.close();
    };
  }, []);

  const liveMessage = busy ? 'Working…' : '';

  return (
    <dialog
      ref={dialogRef}
      role={isDestructive ? 'alertdialog' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onCancel();
      }}
      onClick={(e) => {
        if (!busy && e.target === dialogRef.current) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-md border border-charcoal/10 bg-bone p-6 text-charcoal backdrop:bg-ink/50"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <div id={descId} className="mt-3 text-sm text-charcoal/70">
        {children}
      </div>

      {error && (
        <p className="mt-4 text-sm text-sienna" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button
          ref={confirmRef}
          type="button"
          className={isDestructive ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '…' : confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={SECONDARY_BUTTON}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
