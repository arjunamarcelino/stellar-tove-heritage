// Wallet-specific styling. The export action is irreversible and moves real value, so it uses a
// deliberate sienna/umber "destructive" treatment (not the neutral white AUTH primary, and not an
// alarm red — sienna is the brand's warm-alert tone).

export const WALLET_DESTRUCTIVE_BUTTON_CLASS =
  'w-full inline-flex items-center justify-center rounded-sm bg-sienna px-8 py-3 ' +
  'text-sm font-semibold text-bone transition-colors duration-200 hover:bg-umber ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// "Wallet exported" badge in settings — warm brand pill, text + glyph (never colour alone, WCAG 1.4.1).
export const WALLET_EXPORTED_BADGE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-ochre/30 bg-umber/15 ' +
  'px-2.5 py-0.5 text-xs font-medium text-ochre';

// "Primary" badge in settings — marks the account's primary wallet (isPrimary). Text + glyph, not
// colour alone (WCAG 1.4.1). Re-designation ships in FR-01.04 (WalletSetPrimaryDialog); the field
// itself stays server-authoritative.
export const WALLET_PRIMARY_BADGE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 ' +
  'px-2.5 py-0.5 text-xs font-medium text-white/70';
