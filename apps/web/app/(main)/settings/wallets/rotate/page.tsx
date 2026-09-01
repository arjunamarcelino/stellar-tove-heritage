import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { listWallets } from '@/lib/services/wallets';
import { rotateStatus } from '@/lib/services/walletRotate';
import { MUTED_LINK } from '@/components/ui/surfaces';
import WalletRotationWizard from '@/components/wallet/WalletRotationWizard';
import type { RotationStatusData } from '@/lib/types/api';

export const metadata: Metadata = {
  title: `Rotate wallet — ${SITE_CONFIG.name}`,
};

// Dedicated, reload-safe route for the wallet-rotation flow (TOV-48 / FR-01.12). The source is the
// collector's embedded passkey wallet (derived server-side from the owner-scoped list — never trusted from
// the URL). An in-flight rotation rehydrates from the SSR `initialStatus`. The whole app is already
// force-dynamic + nonce-CSP (proxy.ts), so no per-route dynamic/CSP wiring is needed.
export default async function RotateWalletPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const list = await listWallets(token);
  if (list.status !== 'success') {
    return (
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-heading text-3xl text-charcoal">Rotate wallet</h1>
        <p
          className="mt-4 rounded-md border border-rose-ash/30 bg-rose-ash/5 p-4 text-sm text-umber"
          role="alert"
        >
          {list.message}
        </p>
        <Link href="/settings" className={`${MUTED_LINK} mt-6 inline-block`}>
          ← Back to wallet settings
        </Link>
      </section>
    );
  }

  // The source is the (non-exported) embedded passkey wallet. If there isn't one, there's nothing to rotate.
  const source = list.wallets.find((w) => w.kind === 'embedded_passkey' && !w.exported);
  if (!source) redirect('/settings');

  // Per-user authed read → no route cache. Rehydrates an in-flight rotation for resume.
  const status = await rotateStatus(token, source.id);
  const initialStatus: RotationStatusData | null = status.status === 'success' ? status.data : null;

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-8">
        <Link href="/settings" className={MUTED_LINK}>
          ← Wallet settings
        </Link>
        <h1 className="mt-4 font-heading text-3xl text-charcoal">Rotate to a new wallet</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          Move your fractions to a wallet you control. Your account, handle, and verification stay
          the same.
        </p>
      </div>

      <WalletRotationWizard
        sourceWalletId={source.id}
        wallets={list.wallets}
        initialStatus={initialStatus}
      />
    </section>
  );
}
