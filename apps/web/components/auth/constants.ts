export const AUTH_INPUT_CLASS =
  'w-full rounded-sm border border-white/10 bg-graphite px-4 py-3 text-white ' +
  'placeholder:text-white/40 ' +
  'focus:border-ochre focus:outline-none ' +
  'disabled:opacity-50';

// Full-width primary CTA shared by the login/register/signup forms. Callers add their own margin
// (e.g. `${AUTH_PRIMARY_BUTTON_CLASS} mt-2`).
export const AUTH_PRIMARY_BUTTON_CLASS =
  'w-full inline-flex items-center justify-center rounded-sm bg-white px-8 py-3 ' +
  'text-sm font-semibold text-ink transition-colors duration-200 hover:bg-white/90 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// Full-width secondary/alternative action (e.g. the BYOW fallback on /signup).
export const AUTH_SECONDARY_BUTTON_CLASS =
  'w-full inline-flex items-center justify-center rounded-sm border border-white/10 bg-graphite ' +
  'px-8 py-3 text-sm font-medium text-white transition-colors duration-200 ' +
  'hover:bg-graphite-light disabled:opacity-50';
