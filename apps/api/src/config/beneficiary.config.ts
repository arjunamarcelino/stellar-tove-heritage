import { registerAs } from '@nestjs/config';

/**
 * Beneficiary domain config (TOV-31). The erasure-reconcile sweep (review todo 418) is the backstop for the
 * best-effort per-account purge: a repeatable job that hard-deletes beneficiaries whose owning user is
 * soft-deleted, so a transient purge failure can't leave third-party PII behind. Disabled in tests.
 */
export const beneficiaryConfig = registerAs('beneficiary', () => ({
  erasureSweepEnabled: (process.env.BENEFICIARY_ERASURE_SWEEP_ENABLED ?? 'true') === 'true',
  erasureSweepCron: process.env.BENEFICIARY_ERASURE_SWEEP_CRON ?? '0 4 * * *', // daily 04:00
}));

export type BeneficiaryConfig = ReturnType<typeof beneficiaryConfig>;
