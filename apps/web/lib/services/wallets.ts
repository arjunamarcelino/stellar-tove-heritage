import 'server-only';

import { z } from 'zod/v4';
import { getJson, extractBackendMessage, statusFallbackCode } from '@/lib/services/http';
import type { ListWalletsResult, WalletKind, WalletSummary } from '@/lib/types/api';

// Account wallet reads (owner-scoped). Separate from lib/services/walletConnect.ts (SEP-10 BYOW)
// and from lib/services/walletExport.ts (export mutations). The full TOV-24 surface (add/remove)
// lives in lib/services/walletManage.ts, which reuses the shared shape below.

const LIST_TIMEOUT_MS = 10_000;

// Shared, satisfies-guarded so a new WalletKind is a compile error here (walletExport.ts convention).
export const WALLET_KINDS = ['embedded_passkey', 'byow'] as const satisfies readonly WalletKind[];

// The one canonical wallet shape (GET /v1/me/wallets item and POST /me/wallets 201 body both parse
// against it — walletManage.ts imports this so the list and the add-response can't drift). isPrimary
// and createdAt are .nullish() for forward-compat: a backend that hasn't shipped them (or a
// half-migration sending null) must not fail safeParse and break the whole /settings page.
export const walletObjectSchema = z.object({
  id: z.string(),
  kind: z.enum(WALLET_KINDS),
  address: z.string(),
  exported: z.boolean(),
  // Accept missing OR null on the wire, but normalize to `boolean | undefined` so the parsed shape
  // matches WalletSummary (which never carries null).
  isPrimary: z
    .boolean()
    .nullish()
    .transform((v) => v ?? undefined),
  createdAt: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});

// Compile-time guard: the schema's parsed output must stay assignable to WalletSummary, so a change
// to either (a required field, a type) fails to compile here rather than drifting silently (the
// add-201 body in walletManage.ts returns parsed.data directly as a WalletSummary).
type _AssertWalletShape = z.infer<typeof walletObjectSchema> extends WalletSummary ? true : never;
const _assertWalletShape: _AssertWalletShape = true;
void _assertWalletShape;

const walletsSchema = z.array(walletObjectSchema);

const FALLBACK_MESSAGE = 'Unable to load your wallets. Please try again.';

export async function listWallets(accessToken: string): Promise<ListWalletsResult> {
  const outcome = await getJson('/v1/me/wallets', {
    timeoutMs: LIST_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!outcome.ok) {
    return {
      status: 'error',
      code: statusFallbackCode(outcome.status),
      message: extractBackendMessage(outcome.data, FALLBACK_MESSAGE),
    };
  }

  const parsed = walletsSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { status: 'error', code: 'SERVER_ERROR', message: FALLBACK_MESSAGE };
  }

  return { status: 'success', wallets: parsed.data };
}

// The single address to surface in global chrome (the navbar). Prefers the primary wallet, then the
// embedded passkey wallet, then whatever's first. Returns null on any error / no wallets so the
// caller can fall back to a plain "Wallet" link — a failed lookup must never break the layout.
export async function getDisplayWalletAddress(accessToken: string): Promise<string | null> {
  const result = await listWallets(accessToken);
  if (result.status !== 'success' || result.wallets.length === 0) return null;
  const { wallets } = result;
  const chosen =
    wallets.find((w) => w.isPrimary) ??
    wallets.find((w) => w.kind === 'embedded_passkey') ??
    wallets[0];
  return chosen?.address ?? null;
}
