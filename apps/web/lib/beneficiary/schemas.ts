// Single source of truth for beneficiary-form input validation + transforms (TOV-46 / FR-01.10), shared
// across the client form, the Server Action, and the service. Co-located here (NOT in the `server-only`
// service) via the same shared-across-layers exception as lib/profile/settingsSchemas.ts — the client can't
// import a `server-only` module. The client is the pre-flight gate; the backend re-validates as the real
// authority (and owns the Stellar CRC16 checksum + storing email lower-cased/trimmed).

import { z } from 'zod/v4';
// Narrow subpath (NOT the '@stellar/stellar-sdk' barrel) so the Horizon/Soroban/RPC/axios/eventsource
// graph can never be pulled into the client bundle — the guarantee is structural, not tree-shaking luck.
import { StrKey } from '@stellar/stellar-sdk/base';
import type { Beneficiary } from '@/lib/types/api';
import type { Equals } from '@/lib/types/typeUtils';
import { publicKeySchema } from '@/lib/wallet/schemas';
import {
  NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  RELATIONSHIP_MAX_LENGTH,
  NOTES_MAX_LENGTH,
} from '@/lib/beneficiary/constants';

// ── Field schemas (mirror the backend limits) ────────
export const beneficiaryNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(NAME_MAX_LENGTH);
export const beneficiaryEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(EMAIL_MAX_LENGTH));
export const beneficiaryRelationshipSchema = z.string().trim().max(RELATIONSHIP_MAX_LENGTH);
export const beneficiaryNotesSchema = z.string().trim().max(NOTES_MAX_LENGTH);

// Stellar pubkey: reuse the wallet format schema (56-char G+base32, rejects muxed M… for free) and add the
// TRUE ed25519 CRC16 checksum via the Stellar SDK's StrKey — instant client feedback so a checksum-valid
// typo is caught before it becomes the authoritative inheritance destination. Backend re-validates.
export const beneficiaryStellarSchema = publicKeySchema.refine(
  (value) => StrKey.isValidEd25519PublicKey(value),
  'Invalid Stellar public key',
);

// ── Form values (controlled inputs — all strings; optionals default to '') ──
export interface BeneficiaryFormValues {
  name: string;
  email: string;
  stellarPubkey: string;
  relationship: string;
  notes: string;
}

// The exact five whitelisted keys — the wire contract for a forbidNonWhitelisted endpoint. Explicit type so
// a stray sixth key is a compile error at the single constructor (buildBeneficiaryBody).
export interface BeneficiaryWriteBody {
  name: string;
  email: string;
  stellarPubkey: string | null;
  relationship: string | null;
  notes: string | null;
}

// ── Response schemas (defensive; a drift fails safeParse → SERVER_ERROR) ──
export const beneficiaryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  stellarPubkey: z.string().nullable(),
  relationship: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// LENIENT `notice.code` (z.string(), not z.literal): an unknown future code must NOT fail the whole read —
// the service narrows it to the known literal (else null → "no banner").
export const beneficiaryEnvelopeSchema = z.object({
  beneficiary: beneficiaryRowSchema.nullable(),
  notice: z.object({ code: z.string(), message: z.string().optional() }).nullable(),
});

// ENFORCED drift guard: the `const … = true` is what compiles-red on drift (a bare `type` alias is a no-op).
// `Equals<>` (shared, lib/types/typeUtils) asserts EXACT equality of the parsed row and the domain type.
const _assertBeneficiaryRow: Equals<z.infer<typeof beneficiaryRowSchema>, Beneficiary> = true;
void _assertBeneficiaryRow;

// ── Pure form transforms (data-loss-critical — unit-tested) ──

// FULL-REPLACE body: always emit all five keys; a blank optional becomes null (cleared). NEVER a partial
// patch — the form IS the new truth. Return type is ANNOTATED so a stray key is a compile error here.
// name/email are normalized through their schemas (single source of trim/lowercase/caps); callers reach
// this only after the validity gate has already passed, so a `.parse()` throw would be a programmer error.
export function buildBeneficiaryBody(v: BeneficiaryFormValues): BeneficiaryWriteBody {
  const opt = (s: string): string | null => {
    const t = s.trim();
    return t === '' ? null : t;
  };
  return {
    name: beneficiaryNameSchema.parse(v.name),
    email: beneficiaryEmailSchema.parse(v.email),
    stellarPubkey: opt(v.stellarPubkey),
    relationship: opt(v.relationship),
    notes: opt(v.notes),
  };
}

// Seed the form from a loaded beneficiary — nulls become '' so an untouched optional round-trips unchanged
// (full-replace guard). Empty string at submit ⇒ cleared to null; there is no "preserve" under full-replace.
export function beneficiaryToFormValues(b: Beneficiary): BeneficiaryFormValues {
  return {
    name: b.name,
    email: b.email,
    stellarPubkey: b.stellarPubkey ?? '',
    relationship: b.relationship ?? '',
    notes: b.notes ?? '',
  };
}

export const EMPTY_BENEFICIARY_FORM: BeneficiaryFormValues = {
  name: '',
  email: '',
  stellarPubkey: '',
  relationship: '',
  notes: '',
};

// Compare-only normalization (trim; email lower-cased) — mirrors what buildBeneficiaryBody emits but WITHOUT
// the schema `.parse()` (which throws on an empty/invalid name/email in the create state). The SINGLE source
// for the hook's dirty diff AND the confirm-modal's changed-field diff, so they can never disagree.
export function normalizeBeneficiaryField(key: keyof BeneficiaryFormValues, value: string): string {
  const t = value.trim();
  return key === 'email' ? t.toLowerCase() : t;
}
export function normalizeBeneficiaryValues(v: BeneficiaryFormValues): BeneficiaryFormValues {
  return {
    name: normalizeBeneficiaryField('name', v.name),
    email: normalizeBeneficiaryField('email', v.email),
    stellarPubkey: normalizeBeneficiaryField('stellarPubkey', v.stellarPubkey),
    relationship: normalizeBeneficiaryField('relationship', v.relationship),
    notes: normalizeBeneficiaryField('notes', v.notes),
  };
}

// The whole-form validity contract — the SINGLE source of truth for both the client pre-flight gate and the
// Server Action's defense-in-depth re-validation. `.strict()` rejects extra keys; `z.string()` rejects a
// non-string field, so a hostile/malformed payload fails cleanly (VALIDATION_FAILED) instead of throwing.
// An empty optional is valid (Stellar tolerates surrounding whitespace → treated as unset).
export const beneficiaryFormValuesSchema = z
  .object({
    name: beneficiaryNameSchema,
    email: beneficiaryEmailSchema,
    stellarPubkey: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.union([z.literal(''), beneficiaryStellarSchema])),
    relationship: beneficiaryRelationshipSchema,
    notes: beneficiaryNotesSchema,
  })
  .strict();

// The client-side pre-flight gate. Save is disabled until this returns true. Derived from the one schema
// above (no field-by-field re-implementation).
export function isBeneficiaryFormValid(v: BeneficiaryFormValues): boolean {
  return beneficiaryFormValuesSchema.safeParse(v).success;
}

// Per-field inline error message for display — the SINGLE home for these strings (the form no longer
// hardcodes its own copies). Required-empty messages only surface once the field has been `touched`
// (blurred), so a pristine create form isn't pre-littered with errors.
export function beneficiaryFieldError(
  field: keyof BeneficiaryFormValues,
  value: string,
  touched = false,
): string | undefined {
  const trimmed = value.trim();
  if (field === 'name') {
    if (trimmed === '') return touched ? 'Name is required' : undefined;
    return beneficiaryNameSchema.safeParse(value).success ? undefined : 'Name is too long';
  }
  if (field === 'email') {
    if (trimmed === '') return touched ? 'Email is required' : undefined;
    return beneficiaryEmailSchema.safeParse(value).success
      ? undefined
      : 'Enter a valid email address';
  }
  if (field === 'stellarPubkey') {
    if (trimmed === '') return undefined;
    return beneficiaryStellarSchema.safeParse(trimmed).success
      ? undefined
      : 'Invalid Stellar public key';
  }
  return undefined;
}
