import { redirect } from 'next/navigation';

// The signup and login surfaces are unified: the passkey flow on /login handles both new and
// returning users (the backend decides from the email). /signup redirects there so existing links
// and bookmarks still work. The original standalone signup page is preserved (commented out below)
// in case the surfaces are split again.
export default function SignupPage() {
  redirect('/login');
}

// --- Original standalone passkey signup page (restore to split signup from login) ---
// import type { Metadata } from 'next';
// import Image from 'next/image';
// import Link from 'next/link';
// import { cookies } from 'next/headers';
// import { redirect } from 'next/navigation';
// import { SITE_CONFIG, COOKIE_KEYS } from '@/lib/constants';
// import PasskeySignup from '@/components/auth/PasskeySignup';
//
// export const metadata: Metadata = {
//   title: `Sign Up with Passkey — ${SITE_CONFIG.name}`,
//   description: `Create your ${SITE_CONFIG.name} account and embedded wallet with a passkey — no password, no seed phrase.`,
// };
//
// export default async function SignupPage() {
//   // Guard: an already-authenticated user must not create a second account (plan Edge Case #4).
//   const cookieStore = await cookies();
//   if (cookieStore.get(COOKIE_KEYS.accessToken)?.value) {
//     redirect('/');
//   }
//
//   return (
//     <div className="flex min-h-dvh flex-col bg-black lg:flex-row">
//       {/* Cover image panel */}
//       <div className="hidden lg:block lg:w-[45%] p-8">
//         <div className="relative h-full overflow-hidden">
//           <Image src="/images/cover-auth.png" alt="" fill priority className="object-cover" />
//         </div>
//       </div>
//
//       {/* Mobile cover strip */}
//       <div className="p-6 pb-0 lg:hidden">
//         <div className="relative h-48 overflow-hidden">
//           <Image src="/images/cover-auth.png" alt="" fill priority className="object-cover" />
//         </div>
//       </div>
//
//       {/* Form panel */}
//       <div className="flex flex-1 items-start justify-center px-6 py-12 lg:items-center lg:py-0 sm:px-12">
//         <div className="w-full max-w-md">
//           <h1 className="font-heading text-3xl font-medium text-white md:text-4xl text-center">
//             Create your account
//           </h1>
//           <p className="mt-2 text-sm text-white/50 text-center">
//             Sign up with a passkey — no password, no seed phrase. Your wallet stays yours.
//           </p>
//
//           <PasskeySignup />
//
//           <p className="mt-4 text-center text-sm text-white/50">
//             Already have an account?{' '}
//             <Link href="/login" className="text-ochre hover:text-ochre/80 transition-colors">
//               Login
//             </Link>
//           </p>
//         </div>
//       </div>
//     </div>
//   );
// }
