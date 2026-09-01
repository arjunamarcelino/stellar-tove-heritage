import { describe, it, expect, beforeEach } from 'vitest';
import { saveProgress, restoreProgress, clearProgress } from '@/lib/kyc/progress';
import { KYC_PROGRESS_STORAGE_KEY } from '@/lib/kyc/constants';

beforeEach(() => {
  window.localStorage.clear();
});

describe('kyc progress persistence', () => {
  it('round-trips the jurisdiction', () => {
    saveProgress({ jurisdiction: 'GB' });
    expect(restoreProgress()).toEqual({ jurisdiction: 'GB' });
  });

  it('returns null after clear', () => {
    saveProgress({ jurisdiction: 'US' });
    clearProgress();
    expect(restoreProgress()).toBeNull();
  });

  it('tolerates an older { jurisdiction, step, filledSlots } record (extra keys stripped)', () => {
    window.localStorage.setItem(
      KYC_PROGRESS_STORAGE_KEY,
      JSON.stringify({ jurisdiction: 'SG', step: 'review', filledSlots: ['gov_id_front'] }),
    );
    expect(restoreProgress()).toEqual({ jurisdiction: 'SG' });
  });

  it('discards a corrupt shape or non-JSON', () => {
    window.localStorage.setItem(KYC_PROGRESS_STORAGE_KEY, JSON.stringify({ step: 'nope' }));
    expect(restoreProgress()).toBeNull();
    window.localStorage.setItem(KYC_PROGRESS_STORAGE_KEY, 'not json');
    expect(restoreProgress()).toBeNull();
  });

  it('persists only the jurisdiction key — no blobs, no filenames, no step (no PII)', () => {
    saveProgress({ jurisdiction: 'GB' });
    const raw = window.localStorage.getItem(KYC_PROGRESS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(Object.keys(JSON.parse(raw as string))).toEqual(['jurisdiction']);
  });
});
