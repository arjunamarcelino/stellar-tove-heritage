'use client';

import { useActionState } from 'react';
import { registerAction } from '@/app/actions/register';
import type { RegisterState } from '@/lib/types/api';
import PasswordInput from '@/components/ui/PasswordInput';
import GoogleIcon from '@/components/ui/icons/GoogleIcon';
import AppleIcon from '@/components/ui/icons/AppleIcon';
import { AUTH_INPUT_CLASS, AUTH_PRIMARY_BUTTON_CLASS } from '@/components/auth/constants';

const initialState: RegisterState = { status: 'idle' };

const OAUTH_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-sm border border-white/10 bg-graphite px-4 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-graphite-light disabled:opacity-50';

export default function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerAction, initialState);

  if (state.status === 'success') {
    return (
      <div className="mt-8 rounded-sm border border-white/10 bg-graphite p-6 text-center">
        <p className="text-lg font-medium text-white">Account created!</p>
        <p className="mt-2 text-sm text-white/50">You can now log in with your credentials.</p>
      </div>
    );
  }

  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <>
      {/* OAuth buttons */}
      <div className="mt-8 grid grid-cols-2 gap-4">
        <button type="button" disabled={isPending} className={OAUTH_BUTTON_CLASS}>
          <GoogleIcon className="h-5 w-5" />
          Google
        </button>
        <button type="button" disabled={isPending} className={OAUTH_BUTTON_CLASS}>
          <AppleIcon className="h-5 w-5" />
          Apple ID
        </button>
      </div>

      {/* Divider */}
      <div className="mt-8 flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-white/30">Or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Form */}
      <form action={formAction} className="mt-8 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="first-name" className="block text-sm font-medium text-white/70 mb-2">
              First Name
            </label>
            <input
              id="first-name"
              name="firstName"
              type="text"
              required
              disabled={isPending}
              autoComplete="given-name"
              className={AUTH_INPUT_CLASS}
              placeholder="eg. Leonardo"
            />
            {fieldErrors?.firstName && (
              <p className="mt-1 text-sm text-red-400">{fieldErrors.firstName}</p>
            )}
          </div>
          <div>
            <label htmlFor="last-name" className="block text-sm font-medium text-white/70 mb-2">
              Last Name
            </label>
            <input
              id="last-name"
              name="lastName"
              type="text"
              required
              disabled={isPending}
              autoComplete="family-name"
              className={AUTH_INPUT_CLASS}
              placeholder="eg. Davinci"
            />
            {fieldErrors?.lastName && (
              <p className="mt-1 text-sm text-red-400">{fieldErrors.lastName}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="email"
            className={AUTH_INPUT_CLASS}
            placeholder="eg. leonardodavinci@gmail.com"
          />
          {fieldErrors?.email && <p className="mt-1 text-sm text-red-400">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-white/70 mb-2">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            placeholder="Enter your password"
            autoComplete="new-password"
            disabled={isPending}
          />
          {fieldErrors?.password && (
            <p className="mt-1 text-sm text-red-400">{fieldErrors.password}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-white/70 mb-2"
          >
            Confirm Password
          </label>
          <PasswordInput
            id="confirm-password"
            name="confirmPassword"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            disabled={isPending}
          />
          {fieldErrors?.confirmPassword && (
            <p className="mt-1 text-sm text-red-400">{fieldErrors.confirmPassword}</p>
          )}
        </div>

        {state.status === 'error' && !isPending && (
          <p className="text-sm text-red-400" role="alert">
            {state.message}
          </p>
        )}

        <button type="submit" disabled={isPending} className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-2`}>
          {isPending ? 'Creating Account...' : 'Sign Up'}
        </button>
      </form>
    </>
  );
}
