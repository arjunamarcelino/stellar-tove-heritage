// Neutral, feature-agnostic button classes (promoted out of components/kyc/constants.ts so non-kyc
// surfaces — e.g. the dashboard holdings widget — don't depend on the kyc namespace). The `aria-disabled:`
// variants mirror the `disabled:` ones for controls that use `aria-disabled` instead of the native
// attribute: a native-disabled <button> drops out of the tab order and hides its reason from screen
// readers, so a "disabled but explained" control (e.g. Sell when fully locked) uses aria-disabled.

export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-sm bg-charcoal px-6 py-3 text-sm font-semibold ' +
  'text-bone transition-colors duration-200 hover:bg-ink ' +
  'disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed';

export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-sm border border-charcoal/20 px-6 py-3 text-sm ' +
  'font-medium text-charcoal transition-colors duration-200 hover:bg-charcoal/5 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed';
