import { z } from 'zod/v4';
import {
  KYC_JURISDICTION_CODES,
  KYC_MAX_FILE_BYTES,
  KYC_ACCEPTED_MIME_TYPES,
  type KycJurisdictionCode,
} from '@/lib/kyc/constants';

// Single source of truth for KYC input validation (TOV-34 / FR-01.07), shared across the client wizard
// and the Server Action. Co-located here (not in the `server-only` service) via the same
// shared-across-layers exception as lib/handle/schemas.ts — the client hook can't import a `server-only`
// module, so a plain shared schema module is required. The client is the pre-flight gate; the backend
// re-validates (and magic-number sniffs) as the real authority.

// Jurisdiction: exact enum, NOT a `[A-Z]{2}` regex — a well-formed but off-allowlist code is rejected at
// the BFF, not merely relied upon to hit the backend's 422 (security review L10).
export const jurisdictionSchema = z.enum(KYC_JURISDICTION_CODES);

// A single uploaded document. `z.instanceof(File)` narrows the `File | string | null` that
// FormData.get() yields — never an `as File` cast. Type + size + non-empty are the client pre-flight;
// the backend magic-byte sniff is the content authority.
export const fileSchema = z
  .instanceof(File)
  .refine((f) => f.size > 0, { message: 'This file appears to be empty.' })
  .refine((f) => f.size <= KYC_MAX_FILE_BYTES, {
    message: 'This file is larger than the 10 MB limit.',
  })
  .refine((f) => (KYC_ACCEPTED_MIME_TYPES as readonly string[]).includes(f.type), {
    message: 'Use a JPEG, PNG or PDF file.',
  });

// The complete submission: a valid jurisdiction + all four documents present. The sole gate that asserts
// "exactly these four files" — the hook holds a Partial map, and this schema narrows it before submit.
export const submissionSchema = z.object({
  claimedJurisdiction: jurisdictionSchema,
  gov_id_front: fileSchema,
  gov_id_back: fileSchema,
  proof_of_address: fileSchema,
  selfie: fileSchema,
});

// Non-PII progress metadata persisted to localStorage (direction B): just the jurisdiction code so a
// refresh restores the country and lands the user back on the documents step (files are re-selected). No
// step or filled-slot data is persisted — files can't be restored, so the wizard always resumes at
// `documents`; persisting `step`/`filledSlots` would be dead data and a trap for a future "restore the
// saved step" change that would reintroduce a review-with-no-files state (todo 122). No blobs, no
// filenames, no idempotency key → nothing sensitive at rest. safeParse on restore discards corrupt/legacy
// shapes (an older { jurisdiction, step, filledSlots } record still parses — the extra keys are stripped).
export const progressSchema = z.object({
  jurisdiction: jurisdictionSchema.nullable(),
});

export type KycProgress = z.infer<typeof progressSchema>;

// Compile-time guard: the jurisdiction schema's output must stay assignable to the domain code union, so
// a drift (e.g. widening to bare `string`) fails to compile here rather than silently defeating the
// downstream exhaustive checks.
type _AssertJurisdiction =
  z.infer<typeof jurisdictionSchema> extends KycJurisdictionCode ? true : never;
const _assertJurisdiction: _AssertJurisdiction = true;
void _assertJurisdiction;
