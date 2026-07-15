export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      {children}
    </main>
  );
}
