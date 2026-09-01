// Feature-scoped class re-exports for the quote-acceptance UI (TOV-178 / FR-06.04). Neutral, cross-feature
// classes live in components/ui/ — this module re-exports (under accept-scoped names) only the ones accept
// components actually consume, so the feature doesn't import another feature's namespace (CLAUDE.md convention).
// TONE_* / ERROR_CLASS were dropped as unused re-exports (todo 186) — RfqDetailSection imports TONE_* straight
// from components/ui/surfaces.

export { PRIMARY_BUTTON as ACCEPT_PRIMARY_BUTTON } from '@/components/ui/buttons';
export { SECONDARY_BUTTON as ACCEPT_SECONDARY_BUTTON } from '@/components/ui/buttons';
export { MUTED_LINK } from '@/components/ui/surfaces';
export { MONEY_FIGURE } from '@/components/ui/typography';
