import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { KycDocType, KYC_REQUIRED_DOC_TYPES } from './enums/kyc-doc-type.enum';

/** Authoritative per-file cap; also set as the Multer `limits.fileSize` on the interceptor. */
export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;

type AllowedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

/** One validated document: the buffer + the server-SNIFFED content type (never the client-declared one). */
export interface ValidatedKycDoc {
  buffer: Buffer;
  contentType: AllowedMime;
  size: number;
}

/** The four required documents after validation — a total record, so downstream code needs no `?.`. */
export type ValidatedKycFiles = Record<KycDocType, ValidatedKycDoc>;

type MulterFiles = Record<string, Express.Multer.File[] | undefined>;

/** Magic-number sniff (prefix only — a UX/early-reject control, not the security boundary). */
function sniff(buffer: Buffer): AllowedMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

/**
 * Enforce the four required document fields and per-file content rules, and narrow the loose Multer object
 * to {@link ValidatedKycFiles}. `FileFieldsInterceptor` does NOT error on a missing field, so presence is
 * enforced here. Returns the SNIFFED content type; the client-declared `mimetype` is never trusted or
 * stored. All failures are 422 with a specific `ErrorCode`.
 */
export function validateKycFiles(files: MulterFiles, maxBytes = KYC_MAX_FILE_BYTES): ValidatedKycFiles {
  // Reject any field that is not one of the four required document fields (defense-in-depth; the
  // interceptor also rejects unknown fields with LIMIT_UNEXPECTED_FILE).
  const allowed = new Set<string>(KYC_REQUIRED_DOC_TYPES);
  for (const field of Object.keys(files)) {
    if (!allowed.has(field)) {
      throw failHttp(
        ErrorCode.KYC_UNEXPECTED_DOCUMENT,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Unexpected document field: ${field}`,
      );
    }
  }

  const result = {} as ValidatedKycFiles;
  for (const docType of KYC_REQUIRED_DOC_TYPES) {
    const file = files[docType]?.[0];
    if (!file) {
      throw failHttp(
        ErrorCode.KYC_MISSING_DOCUMENT,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Missing required document: ${docType}`,
      );
    }
    if (file.size === 0 || file.buffer.length === 0) {
      throw failHttp(
        ErrorCode.KYC_FILE_EMPTY,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Document ${docType} is empty`,
      );
    }
    if (file.size > maxBytes) {
      throw failHttp(
        ErrorCode.KYC_FILE_TOO_LARGE,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Document ${docType} exceeds the ${maxBytes}-byte limit`,
      );
    }
    const sniffed = sniff(file.buffer);
    if (!sniffed || sniffed !== file.mimetype) {
      throw failHttp(
        ErrorCode.KYC_UNSUPPORTED_MEDIA_TYPE,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Document ${docType} must be a JPEG, PNG, or PDF matching its declared type`,
      );
    }
    result[docType] = { buffer: file.buffer, contentType: sniffed, size: file.size };
  }
  return result;
}
