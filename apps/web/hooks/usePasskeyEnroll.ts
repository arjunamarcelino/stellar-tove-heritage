'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  PasskeyEnrollState,
  PasskeyServiceErrorCode,
  RegistrationResponseJSON,
  UsePasskeyEnrollReturn,
} from '@/lib/types/api';
import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
} from '@/app/actions/passkey';
import { startPasskeyRegistration } from '@/lib/webauthn/passkey';

const CANCEL_MESSAGE = 'Passkey setup was cancelled or timed out — you can try again.';

// finish errors after which the collected attestation is no longer valid — retry must restart from
// begin. Everything else (WALLET_DEPLOY_FAILED, NETWORK_ERROR, SERVER_ERROR) is a safe same-payload
// finish retry (TOV-21: re-submitting the same finish body is idempotent).
const INVALIDATES_ATTESTATION = new Set<PasskeyServiceErrorCode>([
  'VALIDATION_ERROR',
  'EMAIL_CONFLICT',
  'PASSKEY_ALREADY_BOUND',
  'AUTH_CHALLENGE_EXPIRED',
  'PASSKEY_VERIFICATION_FAILED',
]);

// Orchestrates the client-side WebAuthn ceremony:
//   idle → beginning → signing → finishing → success | error
// A busyRef mutex prevents double-submit (mirrors useWalletConnect). On success the action has
// already set httpOnly cookies; the component shows the wallet address then navigates on a click.
export function usePasskeyEnroll(): UsePasskeyEnrollReturn {
  const [state, setState] = useState<PasskeyEnrollState>({ status: 'idle' });
  const busyRef = useRef(false);
  const emailRef = useRef('');
  // Holds the attestation once the ceremony succeeds, so a finish failure can be retried with the
  // SAME payload rather than minting a fresh passkey via begin (TOV-21 rule).
  const attestationRef = useRef<RegistrationResponseJSON | null>(null);

  // Submits (or re-submits) finish. Assumes the caller holds the busy mutex.
  const submitFinish = useCallback(async (email: string, attestation: RegistrationResponseJSON) => {
    setState({ status: 'finishing' });
    const result = await finishPasskeyRegistrationAction({
      email,
      attestationResponse: attestation,
    });
    if (result.status === 'error') {
      if (INVALIDATES_ATTESTATION.has(result.code)) attestationRef.current = null;
      setState({ status: 'error', code: result.code, message: result.message });
      return;
    }
    attestationRef.current = null;
    setState({ status: 'success', contractAddress: result.contractAddress });
  }, []);

  const enroll = useCallback(
    async (email: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      emailRef.current = email;
      attestationRef.current = null;

      try {
        setState({ status: 'beginning' });
        const beginResult = await beginPasskeyRegistrationAction(email);
        if (beginResult.status === 'error') {
          setState({ status: 'error', code: beginResult.code, message: beginResult.message });
          return;
        }

        setState({ status: 'signing' });
        const ceremony = await startPasskeyRegistration(beginResult.options);
        if (ceremony.status === 'cancelled') {
          setState({ status: 'error', code: 'PASSKEY_CANCELLED', message: CANCEL_MESSAGE });
          return;
        }
        if (ceremony.status === 'error') {
          setState({ status: 'error', code: ceremony.code, message: ceremony.message });
          return;
        }

        attestationRef.current = ceremony.response;
        await submitFinish(email, ceremony.response);
      } finally {
        busyRef.current = false;
      }
    },
    [submitFinish],
  );

  // Recovers from an error. If the attestation is still valid (finish-stage retryable failure),
  // re-submit the SAME payload — bound to the original email, so the passed value is ignored.
  // Otherwise restart the whole ceremony from begin using the live `email` (honours a corrected typo).
  const retry = useCallback(
    async (email: string) => {
      if (busyRef.current) return;

      const attestation = attestationRef.current;
      if (attestation) {
        busyRef.current = true;
        try {
          await submitFinish(emailRef.current, attestation);
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
    attestationRef.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, enroll, retry, reset };
}
