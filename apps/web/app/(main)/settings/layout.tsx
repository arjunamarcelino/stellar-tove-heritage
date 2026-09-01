import SettingsTabs from '@/components/settings/SettingsTabs';

// Nested layout shared by the settings sub-pages (Profile / Wallets / Identity). It only paints the tab
// bar above each page — it intentionally does NOT gate auth and does NOT mount a ToastProvider (toasts are
// local to the Profile page). The tab bar sits in a max-w-2xl gutter that lines up with each page's own
// `mx-auto max-w-2xl px-6 py-16` section, so the existing Wallets/KYC surfaces render unchanged beneath the
// tabs (no double padding).
//
// ⚠️ AUTH IS PER-PAGE, NOT here: a Next layout can't reliably redirect on a client-side navigation, so each
// settings page reads the httpOnly access-token cookie and `redirect('/login')` on a miss. Any NEW
// `settings/*` page MUST do the same — this layout will not protect it.
export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <div className="mx-auto max-w-2xl px-6 pt-16">
        <SettingsTabs />
      </div>
      {children}
    </>
  );
}
