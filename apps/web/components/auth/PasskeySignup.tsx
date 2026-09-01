'use client';

import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { usePasskeyEnroll } from '@/hooks/usePasskeyEnroll';
import { detectPasskeySupport } from '@/lib/webauthn/passkey';
import { useWalletConnect } from '@/hooks/useWalletConnect';
import WalletConnectDialog from '@/components/wallet/WalletConnectDialog';
import Spinner from '@/components/ui/Spinner';
import {
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
} from '@/components/auth/constants';
import { truncateAddress, explorerContractUrl } from '@/lib/wallet/format';
import type { PasskeyEnrollState, PasskeyErrorCode } from '@/lib/types/api';

// Codes with no "Try again" affordance: the email/passkey is bound elsewhere, passkeys are
// unsupported, or the input was invalid (the user edits the email and resubmits the form instead).
const NON_RETRYABLE = new Set<PasskeyErrorCode>([
  'EMAIL_CONFLICT',
  'PASSKEY_ALREADY_BOUND',
  'UNSUPPORTED',
  'VALIDATION_ERROR',
]);

function progressCopy(status: PasskeyEnrollState['status']): string {
  switch (status) {
    case 'beginning':
      return 'Starting…';
    case 'signing':
      return 'Waiting for Face ID, Touch ID, or your device passkey…';
    case 'finishing':
      return 'Finishing up…';
    default:
      return '';
  }
}

// Unified email-first passkey surface: one email field drives both login and signup — the backend
// decides which, and the hook runs the matching WebAuthn ceremony. Rendered on /login.
// Auth lands on '/' via a HARD navigation (window.location), not the client router. The finish
// action set the httpOnly auth cookies server-side; a client-side router.replace can render the
// cookie-gated '/' before it sees them and bounce back to /login. A full-page request to '/'
// always carries the fresh cookies — the same guarantee the old server-redirect login had.
function goToApp() {
  window.location.assign('/');
}

export default function PasskeySignup() {
  const [email, setEmail] = useState('');
  const [support, setSupport] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const { state, enroll, retry } = usePasskeyEnroll();

  // BYOW fallback wiring (mirrors components/layout/Header.tsx).
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const wallet = useWalletConnect();
  const handleWalletDialogClose = useCallback(() => {
    setWalletDialogOpen(false);
    wallet.reset();
  }, [wallet]);

  // Async capability detection with an unmount guard (plan E1) — no CTA flash: nothing renders
  // until `support` resolves.
  useEffect(() => {
    let active = true;
    detectPasskeySupport().then((result) => {
      if (active) setSupport(result.supported);
    });
    return () => {
      active = false;
    };
  }, []);

  // A returning login has no wallet to reveal — send them straight into the app. A fresh signup
  // instead pauses on the wallet-reveal card below (continues on a click).
  useEffect(() => {
    if (state.status === 'success' && state.mode === 'login') {
      goToApp();
    }
  }, [state]);

  const busy =
    state.status === 'beginning' || state.status === 'signing' || state.status === 'finishing';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    void enroll(email);
  };

  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (e.g. insecure context) — the address is still visible to copy manually
    }
  };

  // Login success redirects itself via the effect above — render a brief transition, not the card.
  if (state.status === 'success' && state.mode === 'login') {
    return (
      <div className="mt-8 flex items-center justify-center py-6" role="status" aria-live="polite">
        <Spinner size="sm" className="border-white/20 border-t-white/60" />
        <span className="sr-only">Signing you in…</span>
      </div>
    );
  }

  // Signup success — reveal the freshly deployed wallet address; the user continues when ready
  // (cookies are already set, so navigating home lands authenticated).
  if (state.status === 'success') {
    return (
      <div
        className="mt-8 rounded-sm border border-white/10 bg-graphite p-6"
        role="status"
        aria-live="polite"
      >
        <p className="text-center text-lg font-medium text-white">Account created!</p>
        <p className="mt-2 text-center text-sm text-white/50">Your smart wallet is ready:</p>

        <div className="mt-3 flex items-center justify-between gap-2 rounded-sm border border-white/10 bg-ink/60 px-3 py-2">
          <code className="truncate font-mono text-sm text-ochre" title={state.contractAddress}>
            {truncateAddress(state.contractAddress)}
          </code>
          <button
            type="button"
            onClick={() => handleCopy(state.contractAddress)}
            className="shrink-0 text-xs text-sienna underline hover:text-ochre"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <a
          href={explorerContractUrl(state.contractAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-sienna underline hover:text-ochre"
        >
          View on Stellar Expert ↗
        </a>

        <p className="mt-4 text-sm text-white/70">
          Your wallet is yours — Tove cannot move funds without your passkey.
        </p>

        <button type="button" onClick={goToApp} className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-5`}>
          Continue to Tove
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* Screen-reader progress announcements for the biometric wait (plan E3). */}
      <div aria-live="polite" className="sr-only">
        {progressCopy(state.status)}
      </div>

      {/* Capability pending — neutral placeholder, no CTA flash. */}
      {support === null && (
        <div className="flex items-center justify-center py-6" aria-hidden="true">
          <Spinner size="sm" className="border-white/20 border-t-white/60" />
        </div>
      )}

      {/* Passkeys unavailable — offer the BYOW path inline. */}
      {support === false && (
        <div className="space-y-4">
          <p className="text-sm text-white/60">
            Passkeys aren&apos;t available on this device or browser. You can connect your own
            wallet instead — or try again on a device with Face ID, Touch ID, or Windows Hello.
          </p>
          <button
            type="button"
            onClick={() => setWalletDialogOpen(true)}
            className={AUTH_SECONDARY_BUTTON_CLASS}
          >
            Connect your own wallet
          </button>
        </div>
      )}

      {/* Passkeys available — the primary flow. */}
      {support === true && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-white/70">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              disabled={busy}
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="eg. leonardodavinci@gmail.com"
            />
          </div>

          {state.status === 'error' && (
            <div
              className="rounded-sm border border-red-400/20 bg-red-400/5 px-4 py-3"
              role="alert"
            >
              <p className="text-sm text-red-400">{state.message}</p>
              {!NON_RETRYABLE.has(state.code) && (
                <button
                  type="button"
                  onClick={() => retry(email)}
                  className="mt-2 block text-sm text-sienna underline hover:text-ochre"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <button type="submit" disabled={busy} className={AUTH_PRIMARY_BUTTON_CLASS}>
            {busy ? progressCopy(state.status) : 'Continue with passkey'}
          </button>
        </form>
      )}

      <WalletConnectDialog
        isOpen={walletDialogOpen}
        onClose={handleWalletDialogClose}
        state={wallet.state}
        providerId={wallet.providerId}
        publicKey={wallet.publicKey}
        onSelectProvider={wallet.selectProvider}
        onSign={wallet.sign}
        onRequestManualChallenge={wallet.requestManualChallenge}
        onVerifyManualXdr={wallet.verifyManualXdr}
        onReset={wallet.reset}
      />
    </div>
  );
}
