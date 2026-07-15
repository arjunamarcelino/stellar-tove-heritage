import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { listWallets } from '@/lib/services/wallets';
import WalletSettingsPanel from '@/components/wallet/WalletSettingsPanel';

export const metadata: Metadata = {
  title: `Wallet settings — ${SITE_CONFIG.name}`,
};

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const result = await listWallets(token);

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-heading text-3xl text-charcoal">Wallet settings</h1>
      <p className="mt-2 text-sm text-charcoal/60">
        Manage your Tove wallet and export it to self-custody.
      </p>

      <div className="mt-8">
        {result.status === 'success' ? (
          <WalletSettingsPanel wallets={result.wallets} />
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
