'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  PasskeyEnrollState,
  PasskeyServiceErrorCode,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  UsePasskeyEnrollReturn,
} from '@/lib/types/api';
import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
} from '@/app/actions/passkey';
import { startPasskeyRegistration, startPasskeyAssertion } from '@/lib/webauthn/passkey';

const CANCEL_MESSAGE = 'Passkey setup was cancelled or timed out — you can try again.';

// finish errors after which the collected ceremony response is no longer valid — retry must restart
// from begin. Everything else (WALLET_DEPLOY_FAILED, NETWORK_ERROR, SERVER_ERROR) is a safe
// same-payload finish retry (TOV-21: re-submitting the same finish body is idempotent).
const INVALIDATES_CREDENTIAL = new Set<PasskeyServiceErrorCode>([
  'VALIDATION_ERROR',
  'EMAIL_CONFLICT',
  'PASSKEY_ALREADY_BOUND',
  'AUTH_CHALLENGE_EXPIRED',
  'PASSKEY_VERIFICATION_FAILED',
]);

// The WebAuthn response held for a same-payload finish retry, tagged with the mode begin reported so
// finish is re-submitted down the correct branch (assertion for login, attestation for signup).
type PendingCredential =
  | { mode: 'signup'; response: RegistrationResponseJSON }
  | { mode: 'login'; response: AuthenticationResponseJSON };

// Orchestrates the client-side unified passkey ceremony (login OR signup — the backend decides):
//   idle → beginning → signing → finishing → success | error
// A busyRef mutex prevents double-submit (mirrors useWalletConnect). On success the action has
// already set httpOnly cookies; the component shows the wallet address then navigates on a click.
export function usePasskeyEnroll(): UsePasskeyEnrollReturn {
  const [state, setState] = useState<PasskeyEnrollState>({ status: 'idle' });
  const busyRef = useRef(false);
  const emailRef = useRef('');
  // Holds the ceremony response once it succeeds, so a finish failure can be retried with the SAME
  // payload rather than minting a fresh credential via begin (TOV-21 rule).
  const pendingRef = useRef<PendingCredential | null>(null);

  // Submits (or re-submits) finish. Assumes the caller holds the busy mutex.
  const submitFinish = useCallback(async (email: string, pending: PendingCredential) => {
    setState({ status: 'finishing' });
    const result = await finishPasskeyRegistrationAction(
      pending.mode === 'signup'
        ? { email, mode: 'signup', attestationResponse: pending.response }
        : { email, mode: 'login', assertionResponse: pending.response },
    );
    if (result.status === 'error') {
      if (INVALIDATES_CREDENTIAL.has(result.code)) pendingRef.current = null;
      setState({ status: 'error', code: result.code, message: result.message });
      return;
    }
    pendingRef.current = null;
    setState({ status: 'success', mode: pending.mode, contractAddress: result.contractAddress });
  }, []);

  const enroll = useCallback(
    async (email: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      emailRef.current = email;
      pendingRef.current = null;

      try {
        setState({ status: 'beginning' });
        const beginResult = await beginPasskeyRegistrationAction(email);
        if (beginResult.status === 'error') {
          setState({ status: 'error', code: beginResult.code, message: beginResult.message });
          return;
        }

        setState({ status: 'signing' });
        // Run the ceremony the backend asked for: assertion for a returning login, registration for
        // a brand-new signup.
        const pending = await (async (): Promise<PendingCredential | { status: 'stop' }> => {
          if (beginResult.mode === 'login') {
            const ceremony = await startPasskeyAssertion(beginResult.options);
            if (ceremony.status === 'cancelled') {
              setState({ status: 'error', code: 'PASSKEY_CANCELLED', message: CANCEL_MESSAGE });
              return { status: 'stop' };
            }
            if (ceremony.status === 'error') {
              setState({ status: 'error', code: ceremony.code, message: ceremony.message });
              return { status: 'stop' };
            }
            return { mode: 'login', response: ceremony.response };
          }
          const ceremony = await startPasskeyRegistration(beginResult.options);
          if (ceremony.status === 'cancelled') {
            setState({ status: 'error', code: 'PASSKEY_CANCELLED', message: CANCEL_MESSAGE });
            return { status: 'stop' };
          }
          if (ceremony.status === 'error') {
            setState({ status: 'error', code: ceremony.code, message: ceremony.message });
            return { status: 'stop' };
          }
          return { mode: 'signup', response: ceremony.response };
        })();

        if ('status' in pending) return; // ceremony already set an error/cancel state
        pendingRef.current = pending;
        await submitFinish(email, pending);
      } finally {
        busyRef.current = false;
      }
    },
    [submitFinish],
  );

  // Recovers from an error. If the ceremony response is still valid (finish-stage retryable
  // failure), re-submit the SAME payload — bound to the original email, so the passed value is
  // ignored. Otherwise restart the whole ceremony from begin using the live `email` (honours a
  // corrected typo).
  const retry = useCallback(
    async (email: string) => {
      if (busyRef.current) return;

      const pending = pendingRef.current;
      if (pending) {
        busyRef.current = true;
        try {
          await submitFinish(emailRef.current, pending);
        } finally {
          busyRef.current = false;
        }
      } else {
        await enroll(email);
      }
    },
    [enroll, submitFinish],
  );

  const reset = useCallback(() => {
    busyRef.current = false;
    pendingRef.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, enroll, retry, reset };
}
