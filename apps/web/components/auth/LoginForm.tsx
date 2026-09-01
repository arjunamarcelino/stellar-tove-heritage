// TEMPORARY: email/password login has no FE entry point — /login now uses the unified passkey flow
// (components/auth/PasskeySignup). This component and app/actions/login.ts are preserved (commented
// out) so the password flow can be restored. To re-enable: uncomment both and render <LoginForm />
// on the /login page.
//
// 'use client';
//
// import { useActionState } from 'react';
// import { loginAction } from '@/app/actions/login';
// import type { LoginState } from '@/lib/types/api';
// import PasswordInput from '@/components/ui/PasswordInput';
// import { AUTH_INPUT_CLASS, AUTH_PRIMARY_BUTTON_CLASS } from '@/components/auth/constants';
//
// const initialState: LoginState = { status: 'idle' };
//
// export default function LoginForm() {
//   const [state, formAction, isPending] = useActionState(loginAction, initialState);
//
//   return (
//     <form action={formAction} className="mt-8 space-y-5">
//       <div>
//         <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
//           Email
//         </label>
//         <input
//           id="email"
//           name="email"
//           type="email"
//           required
//           disabled={isPending}
//           autoComplete="email"
//           className={AUTH_INPUT_CLASS}
//           placeholder="eg. leonardodavinci@gmail.com"
//         />
//         {state.status === 'error' && state.fieldErrors?.email && (
//           <p className="mt-1 text-xs text-red-400">{state.fieldErrors.email}</p>
//         )}
//       </div>
//
//       <div>
//         <label htmlFor="password" className="block text-sm font-medium text-white/70 mb-2">
//           Password
//         </label>
//         <PasswordInput
//           id="password"
//           name="password"
//           placeholder="Enter your password"
//           autoComplete="current-password"
//           disabled={isPending}
//         />
//         {state.status === 'error' && state.fieldErrors?.password && (
//           <p className="mt-1 text-xs text-red-400">{state.fieldErrors.password}</p>
//         )}
//       </div>
//
//       {state.status === 'error' && !isPending && (
//         <div
//           role="alert"
//           aria-live="assertive"
//           aria-atomic="true"
//           className="flex items-center gap-3 rounded-sm border border-red-400/20 bg-red-400/5 px-4 py-3"
//         >
//           <p className="text-sm text-red-400">{state.message}</p>
//         </div>
//       )}
//
//       <button type="submit" disabled={isPending} className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-2`}>
//         {isPending ? 'Logging in...' : 'Login'}
//       </button>
//     </form>
//   );
// }

export {};
