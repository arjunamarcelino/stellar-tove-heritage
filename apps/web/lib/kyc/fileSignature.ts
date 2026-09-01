// Client-only magic-byte sniff (FR-01.07): a UX-only pre-flight so a renamed/mismatched file is caught
// before a ~40 MB upload wastes the user's time. The backend's magic-number sniff is the real content
// authority — this reads only the first few header bytes (never the whole file into the heap).

// Internal to this module — the only exported API is isSupportedFile (its unit tests exercise these).
type SniffedKind = 'jpeg' | 'png' | 'pdf';

type SniffResult = { ok: true; kind: SniffedKind } | { ok: false };

// Header signatures as readonly byte tuples (kept typed — never `number[]` with loose indexing).
const SIGNATURES: readonly { kind: SniffedKind; bytes: readonly number[] }[] = [
  { kind: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { kind: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

const MIME_BY_KIND: Record<SniffedKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

// Enough bytes for the longest signature (PNG, 8 bytes). Deliberately tiny — we never read the body.
const HEADER_BYTES = 8;

function matches(header: Uint8Array, sig: readonly number[]): boolean {
  if (header.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (header[i] !== sig[i]) return false;
  }
  return true;
}

// Read the header bytes and return the sniffed kind. Header-only (file.slice) — never the full file.
async function sniffFile(file: File): Promise<SniffResult> {
  const buf = await file.slice(0, HEADER_BYTES).arrayBuffer();
  const header = new Uint8Array(buf);
  for (const sig of SIGNATURES) {
    if (matches(header, sig.bytes)) return { ok: true, kind: sig.kind };
  }
  return { ok: false };
}

// Sniff + cross-check against the declared MIME type. True only when the header is a supported type AND
// agrees with file.type (catches a renamed .png→.jpg and a spoofed extension).
export async function isSupportedFile(file: File): Promise<boolean> {
  const sniff = await sniffFile(file);
  if (!sniff.ok) return false;
  return MIME_BY_KIND[sniff.kind] === file.type;
}
