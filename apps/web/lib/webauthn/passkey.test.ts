import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FakeWebAuthnError,
  fakeCreationOptions,
  fakeRegistrationResponse,
  fakeRequestOptions,
  fakeAssertionResponse,
} from '@/test/fixtures/passkey';

const mocks = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: mocks.startRegistration,
  startAuthentication: mocks.startAuthentication,
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable: mocks.platformAuthenticatorIsAvailable,
  // Re-export the SAME stub class so `instanceof WebAuthnError` narrowing works in the SUT.
  WebAuthnError: FakeWebAuthnError,
}));

import {
  startPasskeyRegistration,
  startPasskeyAssertion,
  buildAssertionOptions,
  detectPasskeySupport,
} from '@/lib/webauthn/passkey';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startPasskeyRegistration', () => {
  it('returns success with the RegistrationResponseJSON on happy path', async () => {
    mocks.startRegistration.mockResolvedValue(fakeRegistrationResponse);
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toEqual({ status: 'success', response: fakeRegistrationResponse });
    expect(mocks.startRegistration).toHaveBeenCalledWith({ optionsJSON: fakeCreationOptions });
  });

  it('never throws — a plain Error resolves to an error result', async () => {
    mocks.startRegistration.mockRejectedValue(new Error('boom'));
    await expect(startPasskeyRegistration(fakeCreationOptions)).resolves.toMatchObject({
      status: 'error',
      code: 'PASSKEY_FAILED',
    });
  });

  it('maps ERROR_CEREMONY_ABORTED to cancelled', async () => {
    mocks.startRegistration.mockRejectedValue(new FakeWebAuthnError('ERROR_CEREMONY_ABORTED'));
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('maps passthrough with NotAllowedError cause to cancelled', async () => {
    mocks.startRegistration.mockRejectedValue(
      new FakeWebAuthnError(
        'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        new DOMException('cancelled', 'NotAllowedError'),
      ),
    );
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('maps passthrough with a non-NotAllowedError cause to PASSKEY_FAILED (not cancelled)', async () => {
    mocks.startRegistration.mockRejectedValue(
      new FakeWebAuthnError(
        'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        new DOMException('x', 'SecurityError'),
      ),
    );
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toMatchObject({ status: 'error', code: 'PASSKEY_FAILED' });
  });

  it('maps ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED to PASSKEY_ALREADY_BOUND', async () => {
    mocks.startRegistration.mockRejectedValue(
      new FakeWebAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'),
    );
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toMatchObject({ status: 'error', code: 'PASSKEY_ALREADY_BOUND' });
  });

  it('maps an unknown WebAuthnError code to PASSKEY_FAILED with a message', async () => {
    mocks.startRegistration.mockRejectedValue(new FakeWebAuthnError('ERROR_SOMETHING_NEW'));
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toMatchObject({ status: 'error', code: 'PASSKEY_FAILED' });
  });

  it('maps a raw NotAllowedError DOMException to cancelled', async () => {
    mocks.startRegistration.mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    const result = await startPasskeyRegistration(fakeCreationOptions);
    expect(result).toEqual({ status: 'cancelled' });
  });
});

describe('startPasskeyAssertion', () => {
  it('returns success with the AuthenticationResponseJSON on happy path', async () => {
    mocks.startAuthentication.mockResolvedValue(fakeAssertionResponse);
    const result = await startPasskeyAssertion(fakeRequestOptions);
    expect(result).toEqual({ status: 'success', response: fakeAssertionResponse });
    expect(mocks.startAuthentication).toHaveBeenCalledWith({ optionsJSON: fakeRequestOptions });
  });

  it('never throws — a plain Error resolves to PASSKEY_FAILED', async () => {
    mocks.startAuthentication.mockRejectedValue(new Error('boom'));
    await expect(startPasskeyAssertion(fakeRequestOptions)).resolves.toMatchObject({
      status: 'error',
      code: 'PASSKEY_FAILED',
    });
  });

  it('maps ERROR_CEREMONY_ABORTED to cancelled', async () => {
    mocks.startAuthentication.mockRejectedValue(new FakeWebAuthnError('ERROR_CEREMONY_ABORTED'));
    expect(await startPasskeyAssertion(fakeRequestOptions)).toEqual({ status: 'cancelled' });
  });

  it('maps passthrough with NotAllowedError cause to cancelled (opaque cancel/timeout/no-cred)', async () => {
    mocks.startAuthentication.mockRejectedValue(
      new FakeWebAuthnError(
        'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        new DOMException('cancelled', 'NotAllowedError'),
      ),
    );
    expect(await startPasskeyAssertion(fakeRequestOptions)).toEqual({ status: 'cancelled' });
  });

  it('maps passthrough with a non-NotAllowedError cause to PASSKEY_FAILED', async () => {
    mocks.startAuthentication.mockRejectedValue(
      new FakeWebAuthnError(
        'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        new DOMException('x', 'SecurityError'),
      ),
    );
    expect(await startPasskeyAssertion(fakeRequestOptions)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_FAILED',
    });
  });

  it('maps a raw NotAllowedError DOMException to cancelled', async () => {
    mocks.startAuthentication.mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    expect(await startPasskeyAssertion(fakeRequestOptions)).toEqual({ status: 'cancelled' });
  });

  it('maps an unknown WebAuthnError code to PASSKEY_FAILED', async () => {
    mocks.startAuthentication.mockRejectedValue(new FakeWebAuthnError('ERROR_INVALID_RP_ID'));
    expect(await startPasskeyAssertion(fakeRequestOptions)).toMatchObject({
      status: 'error',
      code: 'PASSKEY_FAILED',
    });
  });
});

describe('buildAssertionOptions', () => {
  const base = {
    challenge: 'Y2hhbGxlbmdl',
    credentialId: 'Y3JlZElk',
    rpId: 'tove.io',
    timeoutMs: 120000,
  };

  it('assembles required-UV options with the challenge and credential', () => {
    const opts = buildAssertionOptions({ ...base, transports: 'internal' });
    expect(opts).toMatchObject({
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'tove.io',
      timeout: 120000,
      userVerification: 'required',
    });
    expect(opts.allowCredentials).toEqual([
      { id: 'Y3JlZElk', type: 'public-key', transports: ['internal'] },
    ]);
  });

  it('drops an unrecognized transport rather than forwarding it', () => {
    const opts = buildAssertionOptions({ ...base, transports: 'bogus-transport' });
    expect(opts.allowCredentials?.[0].transports).toBeUndefined();
  });

  it('omits transports when null', () => {
    const opts = buildAssertionOptions({ ...base, transports: null });
    expect(opts.allowCredentials?.[0].transports).toBeUndefined();
  });
});

describe('detectPasskeySupport', () => {
  const originalPKC = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;

  afterEach(() => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = originalPKC;
  });

  it('returns supported:false and short-circuits when WebAuthn is unsupported', async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(false);
    expect(await detectPasskeySupport()).toEqual({ supported: false });
    expect(mocks.platformAuthenticatorIsAvailable).not.toHaveBeenCalled();
  });

  it('uses native getClientCapabilities when available', async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(true);
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      getClientCapabilities: vi.fn().mockResolvedValue({ passkeyPlatformAuthenticator: true }),
    };
    expect(await detectPasskeySupport()).toEqual({ supported: true });
    expect(mocks.platformAuthenticatorIsAvailable).not.toHaveBeenCalled();
  });

  it('falls back to platformAuthenticatorIsAvailable when getClientCapabilities is absent', async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(true);
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};
    mocks.platformAuthenticatorIsAvailable.mockResolvedValue(true);
    expect(await detectPasskeySupport()).toEqual({ supported: true });
  });

  it('returns supported:false when the platform authenticator is unavailable', async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(true);
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};
    mocks.platformAuthenticatorIsAvailable.mockResolvedValue(false);
    expect(await detectPasskeySupport()).toEqual({ supported: false });
  });
});
