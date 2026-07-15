import { z } from 'zod/v4';

export const publicKeySchema = z
  .string()
  .length(56, 'Public key must be 56 characters')
  .regex(/^G[A-Z2-7]+$/, 'Invalid Stellar public key format');

export const signedXdrSchema = z
  .string()
  .min(1, 'Signed XDR is required')
  .max(10240, 'Signed XDR exceeds maximum size')
  .regex(/^[A-Za-z0-9+/=]+$/, 'Invalid base64 format');

// Export destination. Reuses publicKeySchema (G-address, 56 chars) — which rejects muxed M… and
// federation name*domain for free — and refines out the wallet's own address so a Collector can't
// "export" to itself. `ownAddress` is contextual, so this is a factory rather than a bare schema.
export function makeTargetAddressSchema(ownAddress: string) {
  return publicKeySchema.refine((value) => value !== ownAddress, {
    message: 'Enter an address other than this wallet',
  });
}

// Shape guard for the per-item signed assertions the client sends to export/submit — validates the
// b64url fields are present before the action forwards them to the backend (which does the
// authoritative crypto verification).
export const signedExportItemsSchema = z
  .array(
    z.object({
      itemId: z.string(),
      authenticatorData: z.string(),
      clientDataJSON: z.string(),
      signature: z.string(),
    }),
  )
  .min(1, 'At least one signed item is required');
