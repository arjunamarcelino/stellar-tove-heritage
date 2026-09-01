import { cookies } from 'next/headers';
import { COOKIE_KEYS } from '@/lib/constants';
import { getDisplayWalletAddress } from '@/lib/services/wallets';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = (await cookies()).get(COOKIE_KEYS.accessToken)?.value;
  const walletAddress = token ? await getDisplayWalletAddress(token) : null;

  return (
    <>
      <Header variant="solid" walletAddress={walletAddress} />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
