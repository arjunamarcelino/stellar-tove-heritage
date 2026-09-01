import type { Metadata } from 'next';
import Image from 'next/image';
import { SITE_CONFIG } from '@/lib/constants';
import PasskeySignup from '@/components/auth/PasskeySignup';

export const metadata: Metadata = {
  title: `Sign In — ${SITE_CONFIG.name}`,
  description: `Sign in to ${SITE_CONFIG.name} with a passkey — one email, no password, no seed phrase.`,
};

// No auth-cookie guard here: /login must stay reachable even when a (possibly stale/expired) access
// token cookie is present, since re-authenticating is the point. Guarding on mere cookie presence
// creates a redirect loop with the home page, which bounces a present-but-invalid token back to
// /login (ERR_TOO_MANY_REDIRECTS). A genuinely valid session lands on '/' from the passkey flow.
export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-black lg:flex-row">
      {/* Cover image panel — only rendered at lg+, where it fills ~45vw. */}
      <div className="hidden lg:block lg:w-[45%] p-8">
        <div className="relative h-full overflow-hidden">
          <Image
            src="/images/cover-auth.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 45vw, 0px"
            className="object-cover"
          />
        </div>
      </div>

      {/* Mobile cover strip — only rendered below lg, where it spans the full width. */}
      <div className="p-6 pb-0 lg:hidden">
        <div className="relative h-48 overflow-hidden">
          <Image
            src="/images/cover-auth.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 0px, 100vw"
            className="object-cover"
          />
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-start justify-center px-6 py-12 lg:items-center lg:py-0 sm:px-12">
        <div className="w-full max-w-md">
          <h1 className="font-heading text-3xl font-medium text-white md:text-4xl text-center">
            Continue to Tove
          </h1>
          <p className="mt-2 text-sm text-white/50 text-center">
            Enter your email — we&apos;ll sign you in, or create your account and wallet with a
            passkey. No password, no seed phrase.
          </p>

          {/* One email field handles both returning sign-in and new signup (backend decides). */}
          <PasskeySignup />

          {/* TODO: email/password login has no FE entry point for now — the passkey flow above is the
              single entry. Restore LoginForm (and app/actions/login.ts) to re-enable it.
          <p className="mt-4 text-center text-sm text-white/60">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-ochre hover:text-ochre/80 transition-colors">
              Sign up
            </Link>
          </p> */}
        </div>
      </div>
    </div>
  );
}
