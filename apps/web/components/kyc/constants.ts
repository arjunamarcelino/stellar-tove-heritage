// Shared Tailwind classes for the KYC wizard (light settings surface — charcoal/bone brand tokens).
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';

// The neutral button/surface/link classes now live in components/ui/* (shared across features). Re-exported
// here under the KYC_*/WHITELIST_* names so existing kyc consumers keep working; new surfaces import from ui/*.
export const KYC_PRIMARY_BUTTON = PRIMARY_BUTTON;
export const KYC_SECONDARY_BUTTON = SECONDARY_BUTTON;

export const KYC_ERROR_CLASS = ERROR_CLASS;

// ── Whitelist status card treatments (TOV-45 / FR-01.08) ─────────────
// One card shell, four per-state tones. Semantics never ride on colour alone — an icon + heading carry the
// meaning (a11y), so the tonal overlap between success/warning (both ochre-family, the brand's only warm
// accent — there is no green/red token) is safe. Removed uses sienna, the app's destructive tone.
export const WHITELIST_CARD_BASE = 'flex gap-3 rounded-md border p-4 text-sm';
export const WHITELIST_CARD_NEUTRAL = 'border-charcoal/15 bg-charcoal/5 text-charcoal';
export const WHITELIST_CARD_SUCCESS = 'border-ochre/40 bg-ochre/10 text-umber';
export const WHITELIST_CARD_WARNING = 'border-ochre/60 bg-ochre/20 text-umber';
export const WHITELIST_CARD_DESTRUCTIVE = 'border-sienna/50 bg-sienna/10 text-umber';

// Muted "contact support" / retry link shared by the frozen/removed/degraded states.
export const WHITELIST_SUPPORT_LINK = MUTED_LINK;
