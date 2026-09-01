import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';
import { truncateAddress } from '@/lib/wallet/format';
import { SUMMARY_NOTES_CLAMP } from '@/lib/beneficiary/constants';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';

interface Props {
  // The last-saved values (the hook's baseline) — kept fresh across saves without needing the raw row.
  values: BeneficiaryFormValues;
  onUpdate: () => void;
  onRemove: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-charcoal/60">{label}</dt>
      <dd className="break-words text-charcoal">{children}</dd>
    </div>
  );
}

// Read-only view of the current designation (TOV-46). All free-text fields are rendered as React text nodes
// (auto-escaped); `notes` is clamped so a 1000-char value can't break the layout, and the Stellar key is
// truncated for display (the full key is shown in the confirm modal on change). Update reveals the form;
// Remove opens the destructive confirm.
export default function BeneficiarySummary({ values, onUpdate, onRemove }: Props) {
  const relationship = values.relationship.trim();
  const stellar = values.stellarPubkey.trim();
  const notes = values.notes.trim();
  const clampedNotes =
    notes.length > SUMMARY_NOTES_CLAMP ? `${notes.slice(0, SUMMARY_NOTES_CLAMP)}…` : notes;

  return (
    <div className="rounded-md border border-charcoal/15 bg-white p-6">
      <dl className="space-y-2 text-sm">
        <Row label="Name">{values.name}</Row>
        <Row label="Email">{values.email}</Row>
        {relationship ? <Row label="Relationship">{relationship}</Row> : null}
        {stellar ? (
          <Row label="Stellar address">
            <span className="font-mono">{truncateAddress(stellar)}</span>
          </Row>
        ) : null}
        {clampedNotes ? <Row label="Notes">{clampedNotes}</Row> : null}
      </dl>

      <div className="mt-6 flex items-center gap-3">
        <button type="button" className={PRIMARY_BUTTON} onClick={onUpdate}>
          Update
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
