// Single source of truth for collector public-profile copy (TOV-44 / FR-01.06), shared by the
// PreviouslyKnownAs component. Client-safe (no 'server-only'); mirrors lib/handle/handleMessages.ts.
// The '@' prefix and comma separators are applied by the component, never stored in the data.
export const PROFILE_COPY = {
  previouslyKnownAsLabel: 'previously known as',
  showLess: 'show less',
  moreLabel: (remaining: number) => `+${remaining} more`,
  collapseAriaLabel: 'Show fewer previous handles',
  expandAriaLabel: (remaining: number) => `Show ${remaining} more previous handles`,
} as const;
