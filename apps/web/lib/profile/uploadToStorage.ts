'use client';

import type { AvatarUploadTarget } from '@/lib/types/api';
import { AVATAR_PIPELINE_MESSAGES } from '@/lib/profile/profileSettingsMessages';
import { STORAGE_PUT_TIMEOUT_MS } from '@/lib/profile/settingsConstants';

// The direct browser → Supabase signed PUT (TOV-35 / FR-01.09). Auth is the `?token=…` already embedded in
// `target.url`, so the request forwards a STRICT header allowlist — only `Content-Type` (the file's own type)
// and, if the target carried it, `x-upsert`. Any `Authorization` / `apikey` / `Cookie` the backend may have
// echoed into `target.headers` is dropped: the query token is the sole credential, and a bearer/cookie on the
// wire (or in a proxy log) would be a leak. The failure copy is generic and NEVER interpolates the url or the
// token — they must not reach the DOM, a toast, or console. This never throws (an abort/network error collapses
// to the same `{ ok:false }`), so the pipeline hook always gets a value to branch on.

const UPLOAD_FAILED_MESSAGE = AVATAR_PIPELINE_MESSAGES.UPLOAD_FAILED;

// Only these header names ever reach the wire — an explicit allowlist, not a denylist, so a newly-echoed
// sensitive header can't silently ride along.
function allowlistedHeaders(target: AvatarUploadTarget, file: File): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': file.type };
  const upsert = target.headers?.['x-upsert'];
  if (upsert !== undefined) headers['x-upsert'] = upsert;
  return headers;
}

// A ≤5 MB transfer over a signed URL isn't routed through the http.ts seam, so it gets no timeout for free.
// Combine the caller's generation/unmount signal with a transfer-sized deadline so a stalled socket aborts
// (→ UPLOAD_FAILED) instead of hanging the pipeline on "uploading…" forever (#217).
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(STORAGE_PUT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function uploadToStorage(
  target: AvatarUploadTarget,
  file: File,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(target.url, {
      method: 'PUT',
      headers: allowlistedHeaders(target, file),
      body: file,
      signal: withTimeout(signal),
    });
    if (!res.ok) return { ok: false, message: UPLOAD_FAILED_MESSAGE };
    return { ok: true };
  } catch {
    // Network failure / abort / anything — never rethrow, never surface the url or token.
    return { ok: false, message: UPLOAD_FAILED_MESSAGE };
  }
}
