import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE_CONFIG } from '@/lib/constants';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: `Login — ${SITE_CONFIG.name}`,
  description: `Log in to your ${SITE_CONFIG.name} account to access your collection.`,
};

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-black lg:flex-row">
      {/* Cover image panel */}
      <div className="hidden lg:block lg:w-[45%] p-8">
        <div className="relative h-full overflow-hidden">
          <Image
            src="/images/cover-auth.png"
            alt=""
            fill
            priority
            className="object-cover"
          />
        </div>
      </div>

      {/* Mobile cover strip */}
      <div className="p-6 pb-0 lg:hidden">
        <div className="relative h-48 overflow-hidden">
          <Image
            src="/images/cover-auth.png"
            alt=""
            fill
            priority
            className="object-cover"
          />
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-start justify-center px-6 py-12 lg:items-center lg:py-0 sm:px-12">
        <div className="w-full max-w-md">
          <h1 className="font-heading text-3xl font-medium text-white md:text-4xl text-center">
            Login Account
          </h1>
          <p className="mt-2 text-sm text-white/60 text-center">
            Login to unlock the application demo and other ecosystem access.
          </p>

          <LoginForm />

          <p className="mt-4 text-center text-sm text-white/60">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-ochre hover:text-ochre/80 transition-colors">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
