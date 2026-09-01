import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { listWallets } from '@/lib/services/wallets';
import { deriveTrustlineStatus } from '@/lib/services/trustlineStatus';
import { rotateStatus } from '@/lib/services/walletRotate';
import WalletSettingsPanel from '@/components/wallet/WalletSettingsPanel';
import type { TrustlineStatus, WalletSummary } from '@/lib/types/api';

export const metadata: Metadata = {
  title: `Wallet settings — ${SITE_CONFIG.name}`,
};

// Async child: derives the per-BYOW-wallet USDC trustline status from Horizon (TOV-47). Wrapped in
// <Suspense> so the wallet list paints immediately (via the fallback panel, no badges) and the badges
// stream in when the derive resolves — the settings render never blocks on public Horizon. Each derive
// is fail-open (→ 'unknown') and has its own 2.5s timeout inside the service.
//
// Concurrency: the fan-out is deliberately unbounded — a collector holds only ~1–5 BYOW wallets, and the
// 300s per-address cache (deriveTrustlineStatus) makes steady state ~free, so a concurrency limiter would
// be premature. If BYOW-per-user grows or a dedicated Horizon endpoint is adopted before mainnet scale,
// add a small limiter (e.g. p-limit) here. See todo 239.
async function TrustlineBadges({
  token,
  wallets,
  flash,
}: {
  token: string;
  wallets: WalletSummary[];
  flash?: string;
}) {
  const byow = wallets.filter((w) => w.kind === 'byow');
  // Both reads run inside this Suspense boundary so the wallet list paints immediately and the badges +
  // resume banner stream in — the per-user, uncached rotation-status read never gates the settings TTFB.
  const [settled, rotationActive] = await Promise.all([
    Promise.allSettled(
      byow.map(async (w) => [w.address, await deriveTrustlineStatus(w.address)] as const),
    ),
    isRotationActive(token, wallets),
  ]);
  const trustlineStatuses: Record<string, TrustlineStatus> = {};
  for (const r of settled) {
    if (r.status === 'fulfilled') trustlineStatuses[r.value[0]] = r.value[1];
  }
  return (
    <WalletSettingsPanel
      wallets={wallets}
      trustlineStatuses={trustlineStatuses}
      rotationActive={rotationActive}
      flash={flash}
    />
  );
}

// Is there an unfinished rotation on the embedded source wallet? (state ∉ {none, confirmed}). Fail-safe:
// any read error → not active (no banner). TOV-48. NOTE: this banner heuristic intentionally derives from
// the aggregate `state` label (cheap, and a terminally-`failed` rotation should still surface "Resume"),
// unlike the hook which derives from the item set via deriveSettlementOutcome — the divergence is by design.
async function isRotationActive(token: string, wallets: WalletSummary[]): Promise<boolean> {
  const source = wallets.find((w) => w.kind === 'embedded_passkey' && !w.exported);
  if (!source) return false;
  const status = await rotateStatus(token, source.id);
  return (
    status.status === 'success' && status.data.state !== 'none' && status.data.state !== 'confirmed'
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ rotated?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const { rotated } = await searchParams;
  const flash = rotated ? 'Your wallet rotation is complete.' : undefined;
  const result = await listWallets(token);

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-heading text-3xl text-charcoal">Wallet settings</h1>
      <p className="mt-2 text-sm text-charcoal/60">
        Manage your Tove wallet and export it to self-custody.
      </p>

      <div className="mt-8">
        {result.status === 'success' ? (
          <Suspense fallback={<WalletSettingsPanel wallets={result.wallets} />}>
            {/* rotationActive + flash stream in with the badges so first paint never waits on them. */}
            <TrustlineBadges token={token} wallets={result.wallets} flash={flash} />
          </Suspense>
        ) : (
          <p
            className="rounded-md border border-rose-ash/30 bg-rose-ash/5 p-4 text-sm text-umber"
            role="alert"
          >
            {result.message}
          </p>
        )}
      </div>
    </section>
  );
}
