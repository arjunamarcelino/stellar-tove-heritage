'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Settings sub-navigation. Order mirrors the account journey: your Profile, the Wallets that fund it,
// then the Identity checks that unlock investing. Typed against `Route` so typedRoutes catches a
// mistyped/dead href at build time.
const TABS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings', label: 'Wallets' },
  { href: '/settings/kyc', label: 'Identity' },
  { href: '/settings/beneficiary', label: 'Beneficiary' },
] satisfies { href: Route; label: string }[];

export default function SettingsTabs() {
  const pathname = usePathname();

  return (
    // overflow-x-auto keeps the bar swipeable on narrow screens without ever pushing the body into a
    // horizontal scroll; -mx-6/px-6 lets the scroll region bleed to the section's gutter edges.
    <nav aria-label="Settings" className="-mx-6 overflow-x-auto px-6">
      <ol className="flex min-w-max items-center gap-6 border-b border-charcoal/10">
        {TABS.map((tab) => {
          // '/settings' (Wallets) is the section root, so it must match EXACTLY — otherwise it would
          // also light up under /settings/profile and /settings/kyc. The nested routes match exactly
          // too, which is all we need for these three flat pages. NOTE: if a leaf tab ever gains child
          // routes (e.g. /settings/kyc/submit), swap that tab's test to a prefix match (startsWith) so
          // it stays highlighted on the child — exact match would leave it inactive.
          const isActive = pathname === tab.href;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`-mb-px inline-flex items-center border-b-2 py-3 font-body text-sm whitespace-nowrap transition-colors duration-200 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre ${
                  isActive
                    ? 'border-charcoal font-medium text-charcoal'
                    : 'border-transparent text-charcoal/50 hover:text-charcoal'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
