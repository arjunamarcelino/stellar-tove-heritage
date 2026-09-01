import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import type { Beneficiary, WriteBeneficiaryResult } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  setBeneficiaryAction: vi.fn(),
  removeBeneficiaryAction: vi.fn(),
}));
vi.mock('@/app/actions/beneficiary', () => h);

import { useBeneficiaryForm } from '@/hooks/useBeneficiaryForm';
import { EMPTY_BENEFICIARY_FORM } from '@/lib/beneficiary/schemas';
import { BENEFICIARY_MESSAGES } from '@/lib/beneficiary/beneficiaryMessages';

const BENEFICIARY: Beneficiary = {
  id: 'b1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: null,
  relationship: 'spouse',
  notes: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:00:00.000Z',
};

const SEEDED_VALUES = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: '',
  relationship: 'spouse',
  notes: '',
};

function setup(initial: Beneficiary | null) {
  const onSaved = vi.fn();
  const onRemoved = vi.fn();
  const onSessionExpired = vi.fn();
  const { result } = renderHook(() =>
    useBeneficiaryForm(initial, { onSaved, onRemoved, onSessionExpired }),
  );
  return { result, onSaved, onRemoved, onSessionExpired };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBeneficiaryForm', () => {
  it('seeds values from a Beneficiary and starts clean', () => {
    const { result } = setup(BENEFICIARY);
    expect(result.current.values).toEqual(SEEDED_VALUES);
    expect(result.current.baseline).toEqual(SEEDED_VALUES);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('starts in the empty create state when initial is null', () => {
    const { result } = setup(null);
    expect(result.current.values).toEqual(EMPTY_BENEFICIARY_FORM);
    expect(result.current.baseline).toEqual(EMPTY_BENEFICIARY_FORM);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('flips dirty when a field diverges from the baseline', () => {
    const { result } = setup(BENEFICIARY);
    act(() => result.current.setValue('name', 'John Doe'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);
  });

  it('gates canSave off while the email is invalid, on when dirty + valid', () => {
    const { result } = setup(null);
    act(() => result.current.setValue('name', 'John Doe'));
    act(() => result.current.setValue('email', 'not-an-email'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(false);

    act(() => result.current.setValue('email', 'john@example.com'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);
  });

  it('re-seeds the baseline from the SERVER echo on a successful save', async () => {
    const echoed: Beneficiary = {
      ...BENEFICIARY,
      name: 'Server Canonical Name',
      relationship: 'partner',
    };
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: echoed,
      notice: null,
    } satisfies WriteBeneficiaryResult);
    const { result, onSaved } = setup(BENEFICIARY);

    act(() => result.current.setValue('name', 'Locally Typed Name'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('saved');
    // Reflects the echo, NOT the local input.
    expect(result.current.values.name).toBe('Server Canonical Name');
    expect(result.current.values.relationship).toBe('partner');
    expect(result.current.dirty).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('surfaces a form-level errorMessage on VALIDATION_FAILED', async () => {
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'raw backend message',
    } satisfies WriteBeneficiaryResult);
    const { result } = setup(BENEFICIARY);

    act(() => result.current.setValue('name', 'John Doe'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(BENEFICIARY_MESSAGES.VALIDATION_FAILED);
    expect(result.current.errorMessage).not.toBe('raw backend message');
  });

  it('calls onSessionExpired on a SESSION_EXPIRED save error', async () => {
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'expired',
    } satisfies WriteBeneficiaryResult);
    const { result, onSessionExpired } = setup(BENEFICIARY);

    act(() => result.current.setValue('name', 'John Doe'));
    await act(async () => {
      await result.current.save();
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('clears the snapshot and values to EMPTY on a successful remove', async () => {
    h.removeBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: null,
      notice: null,
    } satisfies WriteBeneficiaryResult);
    const { result, onRemoved } = setup(BENEFICIARY);

    await act(async () => {
      await result.current.remove();
    });

    expect(result.current.status).toBe('saved');
    expect(result.current.values).toEqual(EMPTY_BENEFICIARY_FORM);
    expect(result.current.baseline).toEqual(EMPTY_BENEFICIARY_FORM);
    expect(result.current.dirty).toBe(false);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('guards double save() via busyRef — a second synchronous call is a no-op', async () => {
    let resolveAction: (value: WriteBeneficiaryResult) => void = () => {};
    h.setBeneficiaryAction.mockReturnValue(
      new Promise<WriteBeneficiaryResult>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const { result } = setup(BENEFICIARY);
    act(() => result.current.setValue('name', 'John Doe'));

    await act(async () => {
      const first = result.current.save();
      const second = result.current.save();
      resolveAction({ status: 'success', beneficiary: BENEFICIARY, notice: null });
      await Promise.all([first, second]);
    });

    expect(h.setBeneficiaryAction).toHaveBeenCalledTimes(1);
  });

  it('does not persist PII — the hook source references no web storage', () => {
    const src = readFileSync(join(process.cwd(), 'hooks/useBeneficiaryForm.ts'), 'utf8');
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('sessionStorage');
    expect(src).not.toContain('indexedDB');
  });
});
