import { z } from 'zod/v4';

// Horizon `GET /accounts/{id}` body shape — only the fields the trustline badge derive reads. Kept in
// its own module (NOT lib/stellar/account.ts) so the `'use client'` engine can import account.ts's pure,
// SDK-free helpers WITHOUT dragging `zod` into the settings client bundle. Server-consumed only
// (lib/services/trustlineStatus.ts). `.optional()` fields keep the parse forward-compatible.
const balanceLineSchema = z.object({
  asset_type: z.string(), // 'native' | 'credit_alphanum4' | 'credit_alphanum12'
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
  balance: z.string(),
  is_authorized: z.boolean().optional(),
  selling_liabilities: z.string().optional(),
});

export const horizonAccountSchema = z.object({
  sequence: z.string(),
  subentry_count: z.number(),
  balances: z.array(balanceLineSchema),
});

export type HorizonAccount = z.infer<typeof horizonAccountSchema>;
export type HorizonBalanceLine = z.infer<typeof balanceLineSchema>;
