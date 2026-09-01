import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ submitKycAction: vi.fn() }));
vi.mock('@/app/actions/kyc', () => ({ submitKycAction: h.submitKycAction }));

import { useKycSubmission } from '@/hooks/useKycSubmission';
import { KYC_PROGRESS_STORAGE_KEY } from '@/lib/kyc/constants';

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

function f(bytes: number[], type: string, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

type Hook = ReturnType<typeof useKycSubmission>;

// Fill the wizard to the review step with four valid documents.
async function fillToReview(get: () => Hook) {
  await act(async () => {
    get().selectJurisdiction('GB');
  });
  act(() => {
    get().next();
  });
  await act(async () => {
    await get().setDocument('gov_id_front', f(JPEG, 'image/jpeg', 'a'));
  });
  await act(async () => {
    await get().setDocument('gov_id_back', f(JPEG, 'image/jpeg', 'b'));
  });
  await act(async () => {
    await get().setDocument('proof_of_address', f(PDF, 'application/pdf', 'c'));
  });
  await act(async () => {
    await get().setDocument('selfie', f(PNG, 'image/png', 'd'));
  });
  act(() => {
    get().next();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useKycSubmission', () => {
  it('walks jurisdiction → documents → review and reaches confirmation on a 202', async () => {
    h.submitKycAction.mockResolvedValue({
      status: 'success',
      submissionId: 's1',
      kycStatus: 'pending_review',
    });
    const { result } = renderHook(() => useKycSubmission());
    expect(result.current.state.status).toBe('jurisdiction');

    await fillToReview(() => result.current);
    expect(result.current.state.status).toBe('review');

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toEqual({ status: 'confirmation', submissionId: 's1' });
    expect(h.submitKycAction).toHaveBeenCalledTimes(1);
    const fd = h.submitKycAction.mock.calls[0][0] as FormData;
    expect(fd.get('claimedJurisdiction')).toBe('GB');
    expect(fd.get('idempotencyKey')).toBeTruthy();
    expect(fd.get('selfie')).toBeInstanceOf(File);
    // progress cleared on success
    expect(window.localStorage.getItem(KYC_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('rejects an oversized document with a slot error and does not advance', async () => {
    const { result } = renderHook(() => useKycSubmission());
    await act(async () => {
      result.current.selectJurisdiction('GB');
    });
    act(() => {
      result.current.next();
    });
    const big = new File(['x'.repeat(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await result.current.setDocument('gov_id_front', big);
    });
    expect(result.current.state).toMatchObject({
      status: 'documents',
      slotError: { docType: 'gov_id_front' },
    });
    expect(result.current.files.gov_id_front).toBeUndefined();
  });

  it('routes JURISDICTION_NOT_ELIGIBLE back to the jurisdiction step, preserving uploads', async () => {
    h.submitKycAction.mockResolvedValue({
      status: 'error',
      code: 'JURISDICTION_NOT_ELIGIBLE',
      message: 'That country isn’t eligible.',
    });
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toMatchObject({
      status: 'jurisdiction',
      inlineError: 'That country isn’t eligible.',
    });
    expect(result.current.files.selfie).toBeInstanceOf(File);
  });

  it('routes KYC_ALREADY_PENDING to the blocked view and clears progress', async () => {
    h.submitKycAction.mockResolvedValue({
      status: 'error',
      code: 'KYC_ALREADY_PENDING',
      message: 'Already pending.',
    });
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toEqual({ status: 'blocked', reason: 'pending' });
    expect(window.localStorage.getItem(KYC_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('routes IDEMPOTENCY_KEY_IN_FLIGHT to the blocked/pending view (no retry loop) and clears progress', async () => {
    h.submitKycAction.mockResolvedValue({
      status: 'error',
      code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      message: 'Still processing.',
    });
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toEqual({ status: 'blocked', reason: 'pending' });
    expect(window.localStorage.getItem(KYC_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('routes SESSION_EXPIRED to the sessionExpired state', async () => {
    h.submitKycAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'Session expired.',
    });
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state.status).toBe('sessionExpired');
  });

  it('serializes concurrent submits via the busy guard (action called once)', async () => {
    let resolve!: (v: unknown) => void;
    h.submitKycAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    await act(async () => {
      void result.current.submit();
      void result.current.submit();
    });
    await waitFor(() => expect(h.submitKycAction).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve({ status: 'success', submissionId: 's', kycStatus: 'pending_review' });
    });
  });

  it('back from review preserves the uploaded files', async () => {
    const { result } = renderHook(() => useKycSubmission());
    await fillToReview(() => result.current);
    act(() => {
      result.current.back();
    });
    expect(result.current.state.status).toBe('documents');
    expect(result.current.files.gov_id_front).toBeInstanceOf(File);
    expect(result.current.files.selfie).toBeInstanceOf(File);
  });
});
