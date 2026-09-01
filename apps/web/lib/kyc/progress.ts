import { KYC_PROGRESS_STORAGE_KEY } from '@/lib/kyc/constants';
import { progressSchema, type KycProgress } from '@/lib/kyc/schemas';

// Non-PII progress persistence for resume-on-refresh (direction B, FR-01.07). Stores ONLY the jurisdiction
// code — no blobs, no filenames, no step, no idempotency key ever touch storage, so there is nothing
// sensitive at rest and no logout-purge obligation. localStorage, SSR-guarded (no window on the server).
// Every read is safeParse'd so a corrupt/legacy shape is discarded, not trusted.
//
// Multi-tab (todo 124): all tabs share one fixed key with no storage-event coordination, so the persisted
// jurisdiction is last-writer-wins. This is a benign UX-only limitation — the idempotency key is per-tab
// (a useRef, never shared), and the authoritative duplicate-submission guard is server-side (the page's
// kycStatus gate + the backend KYC_ALREADY_PENDING). No cross-tab key reuse or duplicate submission can
// result. Left uncoordinated for MVP; add a BroadcastChannel if concurrent-tab KYC becomes a real path.

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function saveProgress(progress: KycProgress): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(KYC_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full / disabled (private mode) — resume is best-effort; the flow works without it.
  }
}

export function restoreProgress(): KycProgress | null {
  if (!hasStorage()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KYC_PROGRESS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = progressSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not valid JSON → discard.
    return null;
  }
}

export function clearProgress(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(KYC_PROGRESS_STORAGE_KEY);
  } catch {
    // no-op
  }
}
