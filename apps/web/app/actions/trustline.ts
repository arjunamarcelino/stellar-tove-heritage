'use server';

import { updateTag } from 'next/cache';
import { isValidStellarPublicKey } from '@/lib/stellar/account';
import { trustlineTag } from '@/lib/services/trustlineStatus';

// Bust the cached badge derive for one BYOW address after a successful client-side trustline add
// (TOV-47). The add is client→Horizon direct (no Server Action), so without this the 300s-cached
// `deriveTrustlineStatus` would keep returning the stale 'missing'/'unfunded' value after the user's
// router.refresh(), leaving the "USDC trustline needed" badge up for up to 5 minutes.
//
// Uses Next 16's `updateTag` (the Server-Action read-your-own-writes primitive) so the caller's
// subsequent render re-reads fresh. Safe to call unauthenticated: it only invalidates a cache keyed by
// a PUBLIC Stellar address and triggers a re-read of PUBLIC on-chain state — no data is read or exposed
// here. Address is strkey-validated so a malformed tag is never invalidated.
export async function revalidateTrustlineStatus(address: string): Promise<void> {
  if (!isValidStellarPublicKey(address)) return;
  updateTag(trustlineTag(address));
}
