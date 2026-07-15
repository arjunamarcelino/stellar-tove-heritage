import type { CheckHandleReason, SetHandleErrorCode } from '@/lib/types/api';

// Single source of truth for handle-picker copy, shared by the client hook (check reasons + submit
// errors) and the server (service/action fallbacks) so the two can't fork (mirrors manageMessages.ts).
// Client-safe (no 'server-only'). The raw backend `message` is never surfaced — only these strings.
//
// Keyed on the UI-facing union: the check's wire `reason`s PLUS the commit error codes. `reason`
// values ('taken'/'reserved'/'invalid_format') and their commit-code cousins ('HANDLE_TAKEN'/…) are
// distinct keys deliberately — the check and commit endpoints speak different vocabularies. Exhaustive
// over both unions, so adding a code fails to compile until copy is supplied.
export const HANDLE_MESSAGES: Record<CheckHandleReason | SetHandleErrorCode, string> = {
  // Check reasons (GET /handles/check)
  taken: 'That handle is taken (handles aren’t case-sensitive). Try another.',
  reserved: 'That handle is reserved. Please choose another.',
  invalid_format: 'That handle isn’t valid. Please choose another.',
  // Commit error codes (POST /me/handle)
  HANDLE_TAKEN: 'That handle was just taken. Please choose another.',
  HANDLE_FORMAT_INVALID: 'That handle isn’t valid. Please choose another.',
  HANDLE_RESERVED: 'That handle is reserved. Please choose another.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
