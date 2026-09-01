import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

// Public (unauthenticated) route group — anonymous surfaces like the collector profile /c/[handle]
// (TOV-44). Mirrors (main)/layout.tsx so public pages get the same Header + Footer chrome; the root
// layout renders no chrome. Route groups don't affect the URL, so /c/:handle stays /c/:handle.
export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header variant="solid" />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
