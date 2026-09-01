'use client';

import { useEffect, useId, useState } from 'react';
import type { KycDocType } from '@/lib/types/api';

// Thumbnail width (px) for image previews — small enough that even three concurrent previews cost KBs.
const THUMBNAIL_WIDTH = 240;

interface Props {
  docType: KycDocType;
  label: string;
  hint: string;
  accept: string;
  capture?: 'user';
  file?: File;
  error?: string;
  onSelect: (docType: KycDocType, file: File) => void;
  onRemove: (docType: KycDocType) => void;
}

// One document slot. A visually-hidden but focusable <input type="file"> wrapped by a <label> gives
// click + keyboard operability and a proper accessible name for free; drag-and-drop is a pointer-only
// enhancement layered on top. Image previews use an object URL revoked on file change/unmount (PDFs show
// a doc icon + filename, never an embedded blob viewer).
export default function DocumentUpload({
  docType,
  label,
  hint,
  accept,
  capture,
  file,
  error,
  onSelect,
  onRemove,
}: Props) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [dragOver, setDragOver] = useState(false);

  // Image previews use a DOWNSCALED thumbnail, never the source. CSS caps display size, not decode size —
  // a full-res phone photo (a 12 MP JPEG decodes to ~48 MB of bitmap) rendered directly, times up to three
  // slots, can crash a low-RAM mobile tab (todo 120). createImageBitmap resizes off the source, we paint a
  // small canvas and preview that tiny blob. setState lives inside the async fn (not the effect body), and
  // every path revokes its object URL on file change / unmount. PDFs get a doc icon (previewUrl stays null).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function buildThumbnail() {
      if (!file || !file.type.startsWith('image/')) {
        if (!cancelled) setPreviewUrl(null);
        return;
      }
      try {
        const bitmap = await createImageBitmap(file, {
          resizeWidth: THUMBNAIL_WIDTH,
          resizeQuality: 'medium',
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(THUMBNAIL_WIDTH, bitmap.width);
        canvas.height = Math.round(bitmap.height * (canvas.width / bitmap.width));
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.8),
        );
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch {
        // createImageBitmap/canvas unsupported or a decode failure → fall back to the doc icon.
        if (!cancelled) setPreviewUrl(null);
      }
    }

    void buildThumbnail();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  function handleFiles(files: FileList | null) {
    const picked = files?.[0];
    if (picked) onSelect(docType, picked);
  }

  // Reference hintId only when the hint element is actually rendered (no-file branch); once a file is
  // selected that node unmounts, so pointing aria-describedby at it would be a dangling reference.
  const describedBy = [file ? null : hintId, error ? errorId : null].filter(Boolean).join(' ');

  return (
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors ${
          dragOver ? 'border-ochre bg-ochre/5' : 'border-charcoal/25 hover:bg-charcoal/5'
        } ${error ? 'border-rose-ash/50' : ''}`}
      >
        <span className="text-sm font-medium text-charcoal">{label}</span>

        {file ? (
          <span className="flex flex-col items-center gap-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`Preview of your uploaded ${label.toLowerCase()}`}
                decoding="async"
                className="max-h-28 rounded object-contain"
              />
            ) : (
              <span aria-hidden="true" className="text-2xl">
                📄
              </span>
            )}
            <span className="max-w-full truncate text-xs text-charcoal/70">{file.name}</span>
          </span>
        ) : (
          <span id={hintId} className="text-xs text-charcoal/60">
            Drag & drop or tap to upload · {hint}
          </span>
        )}

        <input
          id={inputId}
          type="file"
          accept={accept}
          capture={capture}
          className="sr-only"
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {file && (
        <button
          type="button"
          onClick={() => onRemove(docType)}
          className="text-xs font-medium text-umber underline hover:text-charcoal"
        >
          Remove {label.toLowerCase()}
        </button>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-umber">
          {error}
        </p>
      )}
    </div>
  );
}
