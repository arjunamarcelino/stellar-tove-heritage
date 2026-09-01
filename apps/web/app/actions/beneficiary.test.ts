import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  readAccessToken: vi.fn(),
  setBeneficiary: vi.fn(),
  removeBeneficiary: vi.fn(),
}));

vi.mock('@/lib/cookies', () => ({ readAccessToken: h.readAccessToken }));
vi.mock('@/lib/services/beneficiary', () => ({
  setBeneficiary: h.setBeneficiary,
  removeBeneficiary: h.removeBeneficiary,
}));

import { setBeneficiaryAction, removeBeneficiaryAction } from '@/app/actions/beneficiary';
import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';

// A valid form: required name/email present, all optionals blank.
const VALID_FORM: BeneficiaryFormValues = {
  name: 'Jane Doe',
  email: 'Jane@Example.com',
  stellarPubkey: '',
  relationship: 'spouse',
  notes: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.readAccessToken.mockResolvedValue('tok'); // authenticated by default
});

describe('setBeneficiaryAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await setBeneficiaryAction(VALID_FORM)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before delegating', async () => {
    const result = await setBeneficiaryAction({ ...VALID_FORM, email: 'not-an-email' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name before delegating', async () => {
    const result = await setBeneficiaryAction({ ...VALID_FORM, name: '   ' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('rejects a bad-checksum Stellar pubkey before delegating', async () => {
    const result = await setBeneficiaryAction({
      ...VALID_FORM,
      stellarPubkey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED (no throw) on a malformed payload from a direct call', async () => {
    // A hostile/scripted direct call with missing + wrong-type fields must fail cleanly, not TypeError.
    const result = await setBeneficiaryAction({ name: 123 } as unknown as BeneficiaryFormValues);
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('rejects an extra/unknown key (strict) before delegating', async () => {
    const result = await setBeneficiaryAction({
      ...VALID_FORM,
      hacker: 'x',
    } as unknown as BeneficiaryFormValues);
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.setBeneficiary).not.toHaveBeenCalled();
  });

  it('delegates the built body (blank optionals → null, email normalized) with the cookie token', async () => {
    const success = { status: 'success', beneficiary: {}, notice: null };
    h.setBeneficiary.mockResolvedValue(success);

    const result = await setBeneficiaryAction(VALID_FORM);

    expect(result).toBe(success);
    expect(h.setBeneficiary).toHaveBeenCalledWith('tok', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      stellarPubkey: null,
      relationship: 'spouse',
      notes: null,
    });
  });
});

describe('removeBeneficiaryAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await removeBeneficiaryAction()).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.removeBeneficiary).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token', async () => {
    const success = { status: 'success', beneficiary: null, notice: null };
    h.removeBeneficiary.mockResolvedValue(success);
    expect(await removeBeneficiaryAction()).toBe(success);
    expect(h.removeBeneficiary).toHaveBeenCalledWith('tok');
  });
});
