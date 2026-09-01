// Shared light-surface input/textarea treatment (charcoal border, ochre focus, white bg) — the settings
// surface is light, unlike the dark auth cards' AUTH_INPUT_CLASS. Promoted to components/ui/ so any light
// surface (not just profile) can share one definition and the fields can't drift (CLAUDE.md neutral-classes
// convention). Feature modules re-export it under a feature-scoped name.
export const FIELD_INPUT_CLASS =
  'w-full rounded-sm border border-charcoal/20 bg-white px-4 py-3 text-sm text-charcoal ' +
  'placeholder:text-charcoal/40 focus:border-ochre focus:outline-none disabled:opacity-50';
