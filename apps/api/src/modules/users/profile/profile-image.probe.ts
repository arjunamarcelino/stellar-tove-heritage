import sharp from 'sharp';
import {
  PROFILE_IMAGE_FORMAT_SET,
  PROFILE_MAX_DIMENSION,
  PROFILE_SHARP_INPUT_OPTS,
  ProfileImageFormat,
} from './constants/profile-image.constants';

/** Outcome of the commit-time image probe. */
export type ProbeOutcome = 'ok' | 'too_large' | 'invalid';

function isAllowedFormat(format: string | undefined): format is ProfileImageFormat {
  return format !== undefined && PROFILE_IMAGE_FORMAT_SET.has(format);
}

/**
 * Fast, cheap pre-filter at commit (TOV-30): confirm the uploaded bytes are a supported, sane, single-frame
 * still image before enqueuing derivative work. Header-only (`metadata()`), hardened against decompression
 * bombs. The worker's full decode+re-encode is the AUTHORITATIVE validation — this just gives the client an
 * immediate 422 for obvious junk. `too_large` and `invalid` map to their respective PROFILE_IMAGE_* codes.
 */
export async function probeUpload(buffer: Buffer, maxBytes: number): Promise<ProbeOutcome> {
  if (buffer.length > maxBytes) return 'too_large';

  let format: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let pages: number | undefined;
  try {
    const meta = await sharp(buffer, PROFILE_SHARP_INPUT_OPTS).metadata();
    format = meta.format;
    width = meta.width;
    height = meta.height;
    pages = meta.pages;
  } catch {
    return 'invalid';
  }

  if (!isAllowedFormat(format)) return 'invalid';
  if (width === undefined || height === undefined) return 'invalid';
  if (width > PROFILE_MAX_DIMENSION || height > PROFILE_MAX_DIMENSION) return 'invalid';
  if ((pages ?? 1) > 1) return 'invalid'; // animated / multi-frame
  return 'ok';
}
