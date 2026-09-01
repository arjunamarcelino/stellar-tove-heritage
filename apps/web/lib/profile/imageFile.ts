// Client-only image pre-flight (TOV-35 / FR-01.09): a UX-only gate so a spoofed/undecodable file is caught
// before a wasted ≤5 MB upload. The backend re-validates (magic-byte sniff + decode) at commit as the real
// authority. Reads only the first 12 header bytes (never the whole file into the heap), then decodes
// off-thread via createImageBitmap to confirm the bytes are a real raster image and bound its dimensions.
// Mirrors lib/kyc/fileSignature.ts, extended for WebP and with a decompression-bomb guard.

import { PROFILE_IMAGE_MAX_PIXELS } from '@/lib/profile/settingsConstants';

type SniffedKind = 'jpeg' | 'png' | 'webp';

const MIME_BY_KIND: Record<SniffedKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// Enough for the longest check (WebP needs bytes 8–11). Deliberately tiny — the body is never read here.
const HEADER_BYTES = 12;

const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF" at 0–3
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at 8–11

function matchesAt(header: Uint8Array, sig: readonly number[], offset: number): boolean {
  if (header.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (header[offset + i] !== sig[i]) return false;
  }
  return true;
}

function sniffKind(header: Uint8Array): SniffedKind | null {
  if (matchesAt(header, JPEG, 0)) return 'jpeg';
  if (matchesAt(header, PNG, 0)) return 'png';
  // WebP is a RIFF container: RIFF at 0–3 AND WEBP at 8–11 (RIFF alone is also WAV/AVI).
  if (matchesAt(header, RIFF, 0) && matchesAt(header, WEBP, 8)) return 'webp';
  return null;
}

async function sniffFile(file: File): Promise<SniffedKind | null> {
  const buf = await file.slice(0, HEADER_BYTES).arrayBuffer();
  return sniffKind(new Uint8Array(buf));
}

// Sniff + cross-check against the declared MIME. True only when the header is a supported type AND agrees
// with file.type (catches a renamed .gif→.png and a spoofed extension). SVG has no matching signature, so it
// is rejected here regardless of file.type.
export async function isSupportedImage(file: File): Promise<boolean> {
  const kind = await sniffFile(file);
  if (!kind) return false;
  return MIME_BY_KIND[kind] === file.type;
}

export type ImagePreflightResult =
  | { ok: true; previewUrl: string }
  | { ok: false; message: string };

// Longest edge (px) of the downscaled preview. The avatar slot renders at ~128px (×2 DPR → ~256), so a 256px
// preview covers it without retaining the full-resolution decoded surface.
const PREVIEW_MAX_PX = 256;

// Downscale the ALREADY-DECODED bitmap to a small preview so the retained backing store for the 128px avatar
// is a few KB, not the full-res surface (a 40 MP photo decodes to ~160 MB — a low-RAM-tab killer if held for
// the ~30s pipeline). Falls back to the original file's object URL if the canvas pipeline is unavailable
// (e.g. jsdom, or a decode edge). Never throws.
function buildPreviewUrl(bitmap: ImageBitmap, file: File): string {
  try {
    const scale = Math.min(1, PREVIEW_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return URL.createObjectURL(file);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/webp', 0.85);
    return dataUrl.startsWith('data:image') ? dataUrl : URL.createObjectURL(file);
  } catch {
    return URL.createObjectURL(file);
  }
}

// Full pre-flight beyond the size/MIME schema check: magic-byte sniff → off-thread decode (rejects
// SVG/corrupt bytes, yields intrinsic dimensions) → decompression-bomb bound → a downscaled preview built
// from the SAME decode (so the source is decoded ONCE, not again by a full-res <img>). createImageBitmap
// decodes off the main thread, so this never blocks the UI.
//
// NOTE: the bomb bound necessarily allocates the full decode before it can read the true dimensions — that
// spike is inherent (you need real dimensions) and is bounded upstream by the 5 MB byte cap.
export async function preflightImage(file: File): Promise<ImagePreflightResult> {
  if (!(await isSupportedImage(file))) {
    return { ok: false, message: 'That file doesn’t look like a JPEG, PNG or WebP image.' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, message: 'That image couldn’t be read. Please try another file.' };
  }
  const pixels = bitmap.width * bitmap.height;
  if (pixels > PROFILE_IMAGE_MAX_PIXELS) {
    bitmap.close();
    return {
      ok: false,
      message: 'That image’s dimensions are too large. Please use a smaller photo.',
    };
  }
  const previewUrl = buildPreviewUrl(bitmap, file);
  bitmap.close();
  return { ok: true, previewUrl };
}
