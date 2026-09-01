'use client';

import { Button } from '@/components/ui/button';

interface AllowlistActionsProps {
  /** superadmin-only — Remove is hidden otherwise (backend also enforces 403). */
  canRemove: boolean;
  pending: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

// Presentational only — the manager owns the mutation and result handling. Rendered only when a wallet
// is committed, so there is no "no wallet" disabled state to model (buttons only disable while pending).
export function AllowlistActions({ canRemove, pending, onAdd, onRemove }: AllowlistActionsProps) {
  return (
    <div className="flex gap-2">
      <Button onClick={onAdd} disabled={pending}>
        Add to allowlist
      </Button>
      {canRemove && (
        <Button variant="destructive" onClick={onRemove} disabled={pending}>
          Remove
        </Button>
      )}
    </div>
  );
}
