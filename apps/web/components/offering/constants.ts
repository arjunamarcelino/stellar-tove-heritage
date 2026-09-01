// Shared Tailwind classes for the offering subscription UI (TOV-157 / FR-05.03, WS-F). The neutral
// button/surface/link classes live in components/ui/* (shared across features); re-exported here under
// OFFERING_* names so offering consumers keep a feature-scoped vocabulary without importing another
// feature's namespace (mirrors components/kyc/constants.ts). Brand reality: one warm light theme, no dark
// mode, no green/red — ochre = live/placed, sienna = destructive, charcoal = neutral.
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS } from '@/components/ui/surfaces';
import type { OfferingUiState } from '@/lib/types/api';

// Only the classes offering components actually consume are re-exported (todo 152 dropped the unused
// SECONDARY_BUTTON/MUTED_LINK aliases — ActiveBidCard imports MUTED_LINK straight from ui/surfaces, matching
// the HoldingsWidget precedent).
export const OFFERING_PRIMARY_BUTTON = PRIMARY_BUTTON;
export const OFFERING_ERROR_CLASS = ERROR_CLASS;

// MONEY_FIGURE moved to components/ui/typography.ts (TOV-173) so the RFQ panel can share it without importing
// the offering namespace. Re-exported here so existing offering consumers keep their import path.
export { MONEY_FIGURE } from '@/components/ui/typography';

// Status chip (pill). Semantics ride on a dot + a word, never colour alone (a11y G10) — the tone only
// reinforces it.
export const OFFERING_CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium';

// Per-uiState chip tone. `biddable` (live) = ochre, `canceled` = sienna (destructive), the rest = charcoal
// (neutral). Exhaustive Record so a new OfferingUiState fails to compile until it's given a tone.
export const OFFERING_CHIP_TONE: Record<OfferingUiState, string> = {
  'coming-soon': 'border-charcoal/20 bg-charcoal/5 text-charcoal',
  biddable: 'border-ochre/40 bg-ochre/10 text-umber',
  closed: 'border-charcoal/20 bg-charcoal/5 text-charcoal',
  canceled: 'border-sienna/50 bg-sienna/10 text-umber',
};
