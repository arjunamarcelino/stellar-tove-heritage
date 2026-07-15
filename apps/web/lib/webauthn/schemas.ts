import { z } from 'zod/v4';

// Shared, deterministic email normalization — used by BOTH begin and finish actions so the
// value binds identically on each call (plan Edge Case #5 / A4). trim + lowercase, then validate.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254, 'Email is too long'));

// Shallow shape guard for the WebAuthn attestation before the action forwards it to the backend
// (defense-in-depth on a public, pre-auth endpoint — the backend still does the authoritative
// cryptographic verification). Used only for validation; the ORIGINAL object is forwarded so no
// fields (transports, extensions) are stripped.
export const registrationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
  }),
});
