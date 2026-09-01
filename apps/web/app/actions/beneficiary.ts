'use server';

import { readAccessToken } from '@/lib/cookies';
import { beneficiaryFormValuesSchema, buildBeneficiaryBody } from '@/lib/beneficiary/schemas';
import { BENEFICIARY_MESSAGES } from '@/lib/beneficiary/beneficiaryMessages';
import { setBeneficiary, removeBeneficiary } from '@/lib/services/beneficiary';
import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';
import type { WriteBeneficiaryResult } from '@/lib/types/api';

// Thin server actions for the beneficiary-designation surface (TOV-46 / FR-01.10): read the Bearer token
// from the httpOnly cookie (via the shared readAccessToken — never trust a client-passed token), re-validate
// the form (defense-in-depth) where the client supplies free-form input, delegate to lib/services/beneficiary.
// These NEVER redirect — the client hook decides navigation (on SESSION_EXPIRED it router.replace('/login')s).

const SESSION_ERROR = {
  status: 'error' as const,
  code: 'SESSION_EXPIRED' as const,
  message: BENEFICIARY_MESSAGES.SESSION_EXPIRED,
};

const VALIDATION_ERROR = {
  status: 'error' as const,
  code: 'VALIDATION_FAILED' as const,
  message: BENEFICIARY_MESSAGES.VALIDATION_FAILED,
};

// Full-replace save of the designated beneficiary. A Server Action is a public HTTP entrypoint reachable
// with an ARBITRARY body, so re-validate the WHOLE payload through beneficiaryFormValuesSchema.safeParse
// (defense-in-depth): a malformed/extra-key/wrong-type shape fails cleanly to VALIDATION_FAILED rather than
// throwing, and `parsed.data` is the trimmed/normalized values fed to buildBeneficiaryBody.
export async function setBeneficiaryAction(
  values: BeneficiaryFormValues,
): Promise<WriteBeneficiaryResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  const parsed = beneficiaryFormValuesSchema.safeParse(values);
  if (!parsed.success) return VALIDATION_ERROR;

  return setBeneficiary(token, buildBeneficiaryBody(parsed.data));
}

// Clear the designated beneficiary. Transport-only error union (no free-form input to validate).
export async function removeBeneficiaryAction(): Promise<WriteBeneficiaryResult> {
  const token = await readAccessToken();
  if (!token) return SESSION_ERROR;

  return removeBeneficiary(token);
}
