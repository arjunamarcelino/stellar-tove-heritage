import { type BeneficiaryFormValues, normalizeBeneficiaryField } from '@/lib/beneficiary/schemas';

// The body rendered inside the confirm modal (TOV-46). Owns the create/update/remove summary + the old→new
// diff (referenced by the AC). All values are UNTRUSTED third-party free text — rendered as React text nodes
// (auto-escaped), never raw. The Stellar key is shown UNTRUNCATED on create/update so a checksum-valid typo
// is catchable before it becomes the authoritative inheritance destination (security F3).

interface Props {
  mode: 'create' | 'update' | 'remove';
  baseline: BeneficiaryFormValues | null; // null for create
  next: BeneficiaryFormValues | null; // null for remove
}

const FIELDS: { key: keyof BeneficiaryFormValues; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'stellarPubkey', label: 'Stellar address' },
  { key: 'relationship', label: 'Relationship' },
  { key: 'notes', label: 'Notes' },
];

// `normalizeBeneficiaryField` (shared with the hook's dirty diff) gives an honest comparison/display
// (trim; email lower-cased) so this modal's "changed fields" can never disagree with the form's `dirty`.
const norm = normalizeBeneficiaryField;

export default function BeneficiaryChangeSummary({ mode, baseline, next }: Props) {
  if (mode === 'remove' && baseline) {
    return (
      <div className="space-y-1 text-sm text-charcoal/80">
        <p>This will permanently remove your designated beneficiary:</p>
        <p className="text-charcoal">
          <span className="font-medium">{baseline.name.trim()}</span>
          {baseline.email.trim() ? ` · ${norm('email', baseline.email)}` : ''}
        </p>
      </div>
    );
  }

  if (mode === 'create' && next) {
    return (
      <dl className="space-y-1 text-sm">
        {FIELDS.map(({ key, label }) => {
          const value = norm(key, next[key]);
          return (
            <div key={key} className="flex gap-2">
              <dt className="w-28 shrink-0 text-charcoal/60">{label}</dt>
              <dd className="break-words text-charcoal">{value === '' ? '—' : value}</dd>
            </div>
          );
        })}
      </dl>
    );
  }

  if (mode === 'update' && baseline && next) {
    const changed = FIELDS.map(({ key, label }) => {
      const oldValue = norm(key, baseline[key]);
      const newValue = norm(key, next[key]);
      return { key, label, oldValue, newValue };
    }).filter((f) => f.oldValue !== f.newValue);

    if (changed.length === 0) {
      return <p className="text-sm text-charcoal/70">No changes to save.</p>;
    }

    return (
      <dl className="space-y-2 text-sm">
        {changed.map(({ key, label, oldValue, newValue }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-charcoal/60">{label}</dt>
            <dd className="break-words text-charcoal">
              <span className="text-charcoal/50">{oldValue === '' ? 'not set' : oldValue}</span>
              <span aria-hidden className="px-2 text-charcoal/40">
                →
              </span>
              <span className="font-medium">{newValue === '' ? 'removed' : newValue}</span>
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return null;
}
