'use client';

import { useId, useState } from 'react';
import type { AvatarUploadState, ProfileImageUrls } from '@/lib/types/api';
import Avatar from '@/components/profile/Avatar';
import { PROFILE_IMAGE_MIME } from '@/lib/profile/settingsConstants';
import {
  AVATAR_TIMED_OUT_MESSAGE,
  AVATAR_FAILED_MESSAGE,
} from '@/lib/profile/profileSettingsMessages';
import { SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';

// The avatar picker + live pipeline surface (TOV-35 / FR-01.09). Presentational only — the state machine lives
// in useAvatarUpload; this renders the current avatar (the local preview while a pick is in flight, else the
// active image), a labelled + keyboard-reachable file input (mirrors DocumentUpload), and TWO distinct live
// regions: a polite status line for progress ("Uploading…", "Processing your photo…") and a role="alert" region
// for failures — kept separate so a progress update never preempts (or gets preempted by) an error. `timedOut`
// offers "Check again" (re-poll, keep the preview); `failed`/`error` offer "Start over" (re-pick a file).

const ACCEPT = PROFILE_IMAGE_MIME.join(','); // "image/jpeg,image/png,image/webp"
const PREVIEW_SIZE = 128;

interface Props {
  state: AvatarUploadState;
  previewUrl: string | null;
  activeImage: ProfileImageUrls | null;
  name: string;
  onSelectFile: (f: File) => void;
  onRemove: () => void;
  onRetry: () => void;
}

// The polite progress line — exhaustive over every state.status, with a `never` guard so a newly-added state
// fails to compile until it is given (or explicitly denied) a status line. `null` = nothing to announce.
function statusLine(state: AvatarUploadState): string | null {
  switch (state.status) {
    case 'requesting':
    case 'uploading':
      return 'Uploading your photo…';
    case 'committing':
      return 'Saving your photo…';
    case 'processing':
      return 'Processing your photo…';
    case 'activating':
      return 'Applying your photo…';
    case 'active':
      return 'Your profile photo is updated.';
    case 'removing':
      return 'Removing your photo…';
    case 'timedOut':
      return AVATAR_TIMED_OUT_MESSAGE;
    case 'idle':
    case 'failed':
    case 'error':
      return null;
    default: {
      const _never: never = state;
      return _never;
    }
  }
}

function errorLine(state: AvatarUploadState): string | null {
  if (state.status === 'failed') return AVATAR_FAILED_MESSAGE;
  if (state.status === 'error') return state.message;
  return null;
}

export default function AvatarUploader({
  state,
  previewUrl,
  activeImage,
  name,
  onSelectFile,
  onRemove,
  onRetry,
}: Props) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);

  const hasAvatar = Boolean(previewUrl) || activeImage !== null;
  const status = statusLine(state);
  const error = errorLine(state);

  function handleFiles(files: FileList | null) {
    const picked = files?.[0];
    if (picked) onSelectFile(picked);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview, never remote
          <img
            src={previewUrl}
            alt="Your selected profile photo"
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
            className="rounded-full object-cover"
          />
        ) : (
          // `card` is the safe default for the 128px slot (×2 DPR ≈ 256 source px): large enough not to
          // upscale, small enough not to over-fetch a hero. TOV-30 follow-up (plan R2): confirm the actual
          // thumb/card/hero pixel sizes and switch to `thumb` here if `thumb` already covers ~256px.
          <Avatar image={activeImage} name={name} variant="card" size={PREVIEW_SIZE} />
        )}

        <div className="space-y-2">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-4 text-center text-sm transition-colors ${
              dragOver ? 'border-ochre bg-ochre/5' : 'border-charcoal/25 hover:bg-charcoal/5'
            }`}
          >
            <span className="font-medium text-charcoal">Upload a photo</span>
            <span className="text-xs text-charcoal/60">
              Drag &amp; drop or click · JPEG, PNG or WebP · max 5 MB
            </span>
            <input
              id={inputId}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              // Reset the value after handoff so re-selecting the SAME file (e.g. after "Start over") still
              // fires change — a native file input suppresses change for an identical path otherwise (#219).
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {hasAvatar && (
            <button type="button" onClick={onRemove} className={MUTED_LINK}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      {/* Polite progress region — always present so it's a stable live region the AT tracks. */}
      <p role="status" aria-live="polite" className="text-sm text-charcoal/70">
        {status}
      </p>

      {/* Assertive error region — always present (empty + visually hidden when there's no error) so it too is a
          stable live region, distinct from the polite status above. */}
      {error ? (
        <div role="alert" className={ERROR_CLASS}>
          <p>{error}</p>
          <button type="button" onClick={onRetry} className={`${SECONDARY_BUTTON} mt-3`}>
            Start over
          </button>
        </div>
      ) : (
        <div role="alert" className="sr-only" />
      )}

      {state.status === 'timedOut' && (
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
          Check again
        </button>
      )}
    </div>
  );
}
