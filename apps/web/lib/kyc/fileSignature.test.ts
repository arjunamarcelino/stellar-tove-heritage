import { describe, it, expect } from 'vitest';
import { isSupportedFile } from '@/lib/kyc/fileSignature';

function fileFromBytes(bytes: number[], type: string, name = 'f'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

// The only exported API is isSupportedFile; its cases exercise the internal header sniff (JPEG/PNG/PDF
// detection + declared-type cross-check) end to end.
describe('isSupportedFile', () => {
  it('is true when a JPEG/PNG/PDF header matches the declared type', async () => {
    expect(await isSupportedFile(fileFromBytes(JPEG, 'image/jpeg'))).toBe(true);
    expect(await isSupportedFile(fileFromBytes(PNG, 'image/png'))).toBe(true);
    expect(await isSupportedFile(fileFromBytes(PDF, 'application/pdf'))).toBe(true);
  });

  it('is false when the header contradicts the declared type (renamed file)', async () => {
    expect(await isSupportedFile(fileFromBytes(PNG, 'image/jpeg'))).toBe(false);
  });

  it('is false for an unsupported/unknown header', async () => {
    expect(await isSupportedFile(fileFromBytes([0x47, 0x49, 0x46], 'image/gif'))).toBe(false);
    expect(await isSupportedFile(fileFromBytes([0x00, 0x01, 0x02], 'image/jpeg'))).toBe(false);
  });
});
