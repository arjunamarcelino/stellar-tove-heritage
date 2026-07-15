import Header from '@/components/layout/Header';

export default function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
    </>
  );
}
