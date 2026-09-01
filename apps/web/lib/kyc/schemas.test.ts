import { describe, it, expect } from 'vitest';
import {
  jurisdictionSchema,
  fileSchema,
  submissionSchema,
  progressSchema,
} from '@/lib/kyc/schemas';

function file(type: string, size = 3): File {
  return new File(['x'.repeat(size)], 'f', { type });
}

describe('jurisdictionSchema', () => {
  it('accepts allowlisted codes and rejects everything else (exact enum, case-sensitive)', () => {
    expect(jurisdictionSchema.safeParse('GB').success).toBe(true);
    expect(jurisdictionSchema.safeParse('US').success).toBe(true);
    expect(jurisdictionSchema.safeParse('SG').success).toBe(true);
    expect(jurisdictionSchema.safeParse('NG').success).toBe(false);
    expect(jurisdictionSchema.safeParse('gb').success).toBe(false);
  });
});

describe('fileSchema', () => {
  it('accepts JPEG/PNG/PDF within the 10 MB cap', () => {
    expect(fileSchema.safeParse(file('image/jpeg')).success).toBe(true);
    expect(fileSchema.safeParse(file('image/png')).success).toBe(true);
    expect(fileSchema.safeParse(file('application/pdf')).success).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(fileSchema.safeParse(new File([], 'f', { type: 'image/jpeg' })).success).toBe(false);
  });

  it('rejects a file over the 10 MB cap (11 MB)', () => {
    const big = new File(['x'.repeat(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    expect(fileSchema.safeParse(big).success).toBe(false);
  });

  it('rejects an unsupported type and a non-File value', () => {
    expect(fileSchema.safeParse(file('image/gif')).success).toBe(false);
    expect(fileSchema.safeParse('not a file').success).toBe(false);
  });
});

describe('submissionSchema', () => {
  const complete = () => ({
    claimedJurisdiction: 'GB',
    gov_id_front: file('image/jpeg'),
    gov_id_back: file('image/jpeg'),
    proof_of_address: file('application/pdf'),
    selfie: file('image/png'),
  });

  it('requires a valid jurisdiction and all four documents', () => {
    expect(submissionSchema.safeParse(complete()).success).toBe(true);

    const missing: Record<string, unknown> = complete();
    delete missing.selfie;
    expect(submissionSchema.safeParse(missing).success).toBe(false);

    expect(submissionSchema.safeParse({ ...complete(), claimedJurisdiction: 'NG' }).success).toBe(
      false,
    );
  });
});

describe('progressSchema', () => {
  it('round-trips non-PII progress and rejects a corrupt shape', () => {
    expect(
      progressSchema.safeParse({
        jurisdiction: 'GB',
        step: 'documents',
        filledSlots: ['gov_id_front'],
      }).success,
    ).toBe(true);
    expect(
      progressSchema.safeParse({ jurisdiction: null, step: 'jurisdiction', filledSlots: [] })
        .success,
    ).toBe(true);
    expect(progressSchema.safeParse({ step: 'bogus' }).success).toBe(false);
  });
});
