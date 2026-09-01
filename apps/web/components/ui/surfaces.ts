// Neutral, feature-agnostic surface + link treatments (promoted out of components/kyc/constants.ts so
// non-kyc surfaces — e.g. the dashboard holdings widget — don't depend on the kyc namespace, mirroring the
// button-class promotion in components/ui/buttons.ts).

// Inline error/alert surface (light settings surface — rose-ash accent).
export const ERROR_CLASS = 'rounded-md border border-rose-ash/30 bg-rose-ash/5 p-4 text-sm text-umber';

// Muted underline link shared by retry / contact-support affordances.
export const MUTED_LINK = 'font-medium text-sienna underline underline-offset-2 hover:text-umber';

// ── Tonal card shells (feature-agnostic) ─────────────
// One card shell, four per-state tones — promoted from the whitelist status card (TOV-45) so other surfaces
// (e.g. the offering ActiveBidCard) share the vocabulary without importing the kyc namespace. Semantics never
// ride on colour alone (an icon + heading carry meaning): the brand has ONE warm accent (ochre) and ONE
// destructive tone (sienna) — no green/red. ACCENT marks success/live; WARNING is a stronger ochre; DESTRUCTIVE
// (sienna) marks failure.
export const TONE_CARD_BASE = 'flex gap-3 rounded-md border p-4 text-sm';
export const TONE_NEUTRAL = 'border-charcoal/15 bg-charcoal/5 text-charcoal';
export const TONE_ACCENT = 'border-ochre/40 bg-ochre/10 text-umber';
export const TONE_WARNING = 'border-ochre/60 bg-ochre/20 text-umber';
export const TONE_DESTRUCTIVE = 'border-sienna/50 bg-sienna/10 text-umber';
