/** BullMQ queue names for the FractionToken deploy flow (TOV-233). Single source imported by the
 * producer (backoffice enqueue) and the provider-only worker module, so the string never drifts. */
export const FRACTION_DEPLOY_QUEUE = 'fraction-deploy';
export const FRACTION_RECONCILE_QUEUE = 'fraction-reconcile';

/** Redis lock key for the fraction relayer account — separate from the passkey `RELAYER_ACCOUNT_LOCK`
 * so admin-deploy bursts never contend with user transfers on the shared relayer keypair. */
export const FRACTION_RELAYER_LOCK_KEY = 'relayer:fraction:account';
