import Link from 'next/link';
import { NAV_LINKS, SITE_CONFIG } from '@/lib/constants';

export default function Footer() {
  return (
    <footer className="bg-umber text-bone">
      <div className="mx-auto max-w-[var(--width-content)] px-[var(--spacing-gutter)] py-16">
        <div className="grid gap-12 md:grid-cols-3">
          <div>
            <span className="font-heading text-xl font-medium text-cream">{SITE_CONFIG.name}</span>
            <p className="mt-4 text-sm leading-relaxed text-rose-ash">{SITE_CONFIG.tagline}</p>
          </div>

          <div>
            <span className="block text-xs font-medium uppercase tracking-widest text-flint mb-4">
              Navigation
            </span>
            <ul className="space-y-3">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  {link.href === '#' ? (
                    <span className="cursor-default text-sm text-rose-ash/40">
                      {link.label}
                    </span>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-rose-ash transition-colors duration-200 hover:text-cream"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
              <li>
                <Link
                  href="/waitlist"
                  className="text-sm text-rose-ash transition-colors duration-200 hover:text-cream"
                >
                  Join Waitlist
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <span className="block text-xs font-medium uppercase tracking-widest text-flint mb-4">
              Legal
            </span>
            <ul className="space-y-3">
              {/* TODO: Replace with /terms route when legal pages are built */}
              <li>
                <a
                  href="#"
                  className="text-sm text-rose-ash transition-colors duration-200 hover:text-cream"
                >
                  Terms of Service
                </a>
              </li>
              {/* TODO: Replace with /privacy route when legal pages are built */}
              <li>
                <a
                  href="#"
                  className="text-sm text-rose-ash transition-colors duration-200 hover:text-cream"
                >
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-flint/30 pt-8">
          <p className="text-xs leading-relaxed text-flint">
            This website is for informational purposes only and does not constitute financial
            advice, an offer to sell, or a solicitation of an offer to buy any securities or tokens.
            Investing in tokenized assets carries risk, including potential loss of principal. Past
            performance is not indicative of future results.
          </p>
          <p className="mt-4 text-xs text-flint">
            &copy; {new Date().getFullYear()} {SITE_CONFIG.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
