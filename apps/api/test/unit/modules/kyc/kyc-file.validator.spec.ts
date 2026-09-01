import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { KycDocType } from '@modules/kyc/enums/kyc-doc-type.enum';
import {
  validateKycFiles,
  KYC_MAX_FILE_BYTES,
  type ValidatedKycFiles,
} from '@modules/kyc/kyc-file.validator';

type MulterFiles = Record<string, Express.Multer.File[] | undefined>;

// Magic-byte prefixes the validator sniffs on.
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF-1.7\n', 'ascii');

/** Build a fake Multer file — only `buffer`, `size`, `mimetype` matter to the validator. */
function fakeFile(buffer: Buffer, mimetype: string, size = buffer.length): Express.Multer.File {
  return {
    fieldname: 'doc',
    originalname: 'doc.bin',
    encoding: '7bit',
    mimetype,
    size,
    buffer,
    // Fields the validator ignores but the type requires.
    stream: undefined as unknown as Express.Multer.File['stream'],
    destination: '',
    filename: '',
    path: '',
  };
}

/** Wrap a single fake file as the one-element array Multer's FileFields shape uses. */
function field(file: Express.Multer.File): Express.Multer.File[] {
  return [file];
}

/** A full, valid set: jpeg / png / pdf / jpeg where declared mimetype === sniffed type. */
function validFiles(): MulterFiles {
  return {
    [KycDocType.GOV_ID_FRONT]: field(fakeFile(JPEG_MAGIC, 'image/jpeg')),
    [KycDocType.GOV_ID_BACK]: field(fakeFile(PNG_MAGIC, 'image/png')),
    [KycDocType.PROOF_OF_ADDRESS]: field(fakeFile(PDF_MAGIC, 'application/pdf')),
    [KycDocType.SELFIE]: field(fakeFile(JPEG_MAGIC, 'image/jpeg')),
  };
}

/** Assert that `fn` throws an HttpException whose response body carries the given `errorCode`. */
function expectRejectCode(fn: () => unknown, code: ErrorCode): void {
  let thrown: unknown;
  expect(fn).toThrow();
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(HttpException);
  const body = (thrown as HttpException).getResponse() as { errorCode: string };
  expect(body.errorCode).toBe(code);
}

describe('validateKycFiles', () => {
  it('exposes a 10 MiB per-file cap constant', () => {
    expect(KYC_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('happy path: returns a ValidatedKycFiles with 4 sniffed entries', () => {
    const result: ValidatedKycFiles = validateKycFiles(validFiles());

    expect(Object.keys(result)).toHaveLength(4);
    expect(result[KycDocType.GOV_ID_FRONT].contentType).toBe('image/jpeg');
    expect(result[KycDocType.GOV_ID_BACK].contentType).toBe('image/png');
    expect(result[KycDocType.PROOF_OF_ADDRESS].contentType).toBe('application/pdf');
    expect(result[KycDocType.SELFIE].contentType).toBe('image/jpeg');

    for (const docType of Object.values(KycDocType)) {
      const doc = result[docType];
      expect(Buffer.isBuffer(doc.buffer)).toBe(true);
      expect(doc.buffer.length).toBeGreaterThan(0);
      expect(doc.size).toBe(doc.buffer.length);
    }
  });

  it('throws KYC_MISSING_DOCUMENT when a required field is omitted', () => {
    const files = validFiles();
    delete files[KycDocType.SELFIE];
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_MISSING_DOCUMENT);
  });

  it('throws KYC_MISSING_DOCUMENT when a required field is present but has an empty array', () => {
    const files = validFiles();
    files[KycDocType.SELFIE] = [];
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_MISSING_DOCUMENT);
  });

  it('throws KYC_UNEXPECTED_DOCUMENT for an extra/unknown field name', () => {
    const files = validFiles();
    files.passport = field(fakeFile(JPEG_MAGIC, 'image/jpeg'));
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_UNEXPECTED_DOCUMENT);
  });

  it('throws KYC_FILE_EMPTY for a 0-byte file', () => {
    const files = validFiles();
    files[KycDocType.GOV_ID_FRONT] = field(fakeFile(Buffer.alloc(0), 'image/jpeg', 0));
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_FILE_EMPTY);
  });

  it('throws KYC_FILE_TOO_LARGE when a file exceeds maxBytes', () => {
    const files = validFiles();
    // A valid JPEG far bigger than the tiny 10-byte cap passed below.
    const big = Buffer.concat([JPEG_MAGIC, Buffer.alloc(100, 0x00)]);
    files[KycDocType.GOV_ID_FRONT] = field(fakeFile(big, 'image/jpeg'));
    expectRejectCode(() => validateKycFiles(files, 10), ErrorCode.KYC_FILE_TOO_LARGE);
  });

  it('throws KYC_UNSUPPORTED_MEDIA_TYPE when bytes are unrecognized (text) but declared image/png', () => {
    const files = validFiles();
    files[KycDocType.GOV_ID_FRONT] = field(fakeFile(Buffer.from('hello', 'ascii'), 'image/png'));
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_UNSUPPORTED_MEDIA_TYPE);
  });

  it('throws KYC_UNSUPPORTED_MEDIA_TYPE when declared image/png but bytes sniff as JPEG', () => {
    const files = validFiles();
    files[KycDocType.GOV_ID_FRONT] = field(fakeFile(JPEG_MAGIC, 'image/png'));
    expectRejectCode(() => validateKycFiles(files), ErrorCode.KYC_UNSUPPORTED_MEDIA_TYPE);
  });

  it('stores the SNIFFED content type, not the client-declared one (both valid types)', () => {
    // gov_id_front declared image/jpeg AND bytes are JPEG — the stored contentType is the sniffed value.
    const result = validateKycFiles(validFiles());
    expect(result[KycDocType.GOV_ID_FRONT].contentType).toBe('image/jpeg');
    // proof_of_address is a real PDF; the sniffed value wins and equals application/pdf.
    expect(result[KycDocType.PROOF_OF_ADDRESS].contentType).toBe('application/pdf');
  });
});
