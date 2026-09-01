'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NAV_LINKS } from '@/lib/constants';
import { logoutAction } from '@/app/actions/logout';
import { useMobileMenu } from '@/hooks/useMobileMenu';
import { truncateAddress } from '@/lib/wallet/format';

interface HeaderProps {
  // 'transparent' sits over the dark Hero on the home page. 'solid' gives a dark bar for route
  // groups with a light (alabaster) page background — otherwise the light parchment text has no
  // contrast and the navbar is effectively invisible. Mirrors the dark Footer used on the same pages.
  variant?: 'transparent' | 'solid';
  // The user's wallet address (primary → embedded → first), passed from authenticated layouts. When
  // present the wallet control shows the truncated address; otherwise it's a plain "Wallet" link.
  walletAddress?: string | null;
}

export default function Header({ variant = 'transparent', walletAddress }: HeaderProps) {
  const pathname = usePathname();
  const { menuOpen, close, toggle } = useMobileMenu();
  const walletLabel = walletAddress ? truncateAddress(walletAddress) : 'Wallet';

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 ${
        variant === 'solid' ? 'bg-ink border-b border-white/10' : 'bg-transparent'
      }`}
      style={{ height: 'var(--header-height)' }}
    >
      <nav className="mx-auto flex h-full max-w-[var(--width-content)] items-center justify-between px-[var(--spacing-gutter)]">
        {/* Left — status indicator */}
        <div className="hidden items-center gap-2 lg:flex">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
          <span className="font-body text-xs text-parchment/80">Your access is now available</span>
        </div>

        {/* Center — pill navigation */}
        <ul className="hidden items-center gap-1 rounded-full border border-parchment/20 bg-parchment/5 p-1 lg:flex">
          {NAV_LINKS.map((link) => {
            if (link.href === '#') {
              return (
                <li key={link.label}>
                  <span className="inline-flex cursor-default items-center rounded-full px-5 py-1.5 font-body text-sm text-parchment/30">
                    {link.label}
                  </span>
                </li>
              );
            }

            const isActive = link.href === '/' ? pathname === '/' : pathname === link.href;

            return (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className={`inline-flex items-center rounded-full px-5 py-1.5 font-body text-sm transition-colors duration-200 ${
                    isActive ? 'bg-parchment text-ink' : 'text-parchment/70 hover:text-parchment'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Right — Wallet (manage) + Log Out. The user already has an embedded smart wallet from
            passkey auth, so this links to wallet settings rather than offering a second sign-in. */}
        <div className="hidden items-center gap-4 lg:flex">
          <Link
            href="/settings"
            title={walletAddress ?? undefined}
            className={`rounded-full border border-parchment/20 px-4 py-1.5 text-sm text-parchment/70 transition-colors duration-200 hover:border-parchment/40 hover:text-parchment ${
              walletAddress ? 'font-mono' : 'font-body'
            }`}
          >
            {walletLabel}
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="font-body text-sm text-parchment/70 transition-colors duration-200 hover:text-parchment"
            >
              Log Out
            </button>
          </form>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="relative flex h-[44px] w-[44px] items-center justify-center lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={toggle}
        >
          <span
            className={`absolute h-[2px] w-5 bg-parchment transition-all duration-200 ${
              menuOpen ? 'translate-y-0 rotate-45' : '-translate-y-1.5'
            }`}
          />
          <span
            className={`absolute h-[2px] w-5 bg-parchment transition-all duration-200 ${
              menuOpen ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <span
            className={`absolute h-[2px] w-5 bg-parchment transition-all duration-200 ${
              menuOpen ? 'translate-y-0 -rotate-45' : 'translate-y-1.5'
            }`}
          />
        </button>
      </nav>

      {/* Mobile sidebar backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 lg:hidden ${
          menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
        onClick={close}
      />

      {/* Mobile sidebar */}
      <aside
        id="mobile-menu"
        className={`fixed top-0 left-0 z-50 flex h-dvh w-64 flex-col bg-ink transition-transform duration-300 ease-out lg:hidden ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!menuOpen}
      >
        {/* Close button */}
        <div className="flex justify-end p-4">
          <button
            type="button"
            onClick={close}
            className="flex h-10 w-10 items-center justify-center text-parchment/70 hover:text-parchment"
            aria-label="Close menu"
            tabIndex={menuOpen ? 0 : -1}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex flex-1 flex-col gap-2 px-6">
          {NAV_LINKS.map((link) => {
            if (link.href === '#') {
              return (
                <span
                  key={link.label}
                  className="cursor-default rounded-lg px-4 py-3 font-body text-sm text-parchment/20"
                >
                  {link.label}
                </span>
              );
            }

            const isActive = link.href === '/' ? pathname === '/' : pathname === link.href;

            return (
              <Link
                key={link.label}
                href={link.href}
                className={`rounded-lg px-4 py-3 font-body text-sm transition-colors duration-200 ${
                  isActive
                    ? 'bg-parchment/10 text-parchment'
                    : 'text-parchment/60 hover:bg-parchment/5 hover:text-parchment'
                }`}
                onClick={close}
                tabIndex={menuOpen ? 0 : -1}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Wallet (manage) + Logout at bottom */}
        <div className="border-t border-parchment/10 p-6 flex flex-col gap-2">
          <Link
            href="/settings"
            onClick={close}
            title={walletAddress ?? undefined}
            className={`w-full rounded-lg px-4 py-3 text-left text-sm text-parchment/60 transition-colors duration-200 hover:bg-parchment/5 hover:text-parchment ${
              walletAddress ? 'font-mono' : 'font-body'
            }`}
            tabIndex={menuOpen ? 0 : -1}
          >
            {walletLabel}
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg px-4 py-3 text-left font-body text-sm text-parchment/60 transition-colors duration-200 hover:bg-parchment/5 hover:text-parchment"
              tabIndex={menuOpen ? 0 : -1}
            >
              Log Out
            </button>
          </form>
        </div>
      </aside>
    </header>
  );
}
