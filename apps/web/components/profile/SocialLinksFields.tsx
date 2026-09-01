'use client';

import { parseHandle, buildHandleUrl } from '@/lib/profile/settingsSchemas';
import { PROFILE_FIELD_CLASS } from '@/components/profile/fieldClasses';

type Platform = 'twitter' | 'instagram';

interface HandleFieldProps {
  platform: Platform;
  label: string;
  placeholder: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

// A handle field with a LIVE preview: a valid handle shows the exact URL we'll store (the parseHandle ⇄
// buildHandleUrl round-trip), a non-empty invalid handle shows the parse error, and an empty field shows
// nothing. Both the preview and the per-field error are wired via aria-describedby.
function HandleField({
  platform,
  label,
  placeholder,
  value,
  error,
  disabled,
  onChange,
}: HandleFieldProps) {
  const id = `profile-${platform}`;
  const previewId = `${id}-preview`;
  const errorId = `${id}-error`;

  const trimmed = value.trim();
  const parsed = parseHandle(value, platform);
  const preview =
    trimmed === '' ? null : parsed.ok ? buildHandleUrl(parsed.handle, platform) : parsed.message;

  const describedBy =
    [preview ? previewId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-charcoal">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={PROFILE_FIELD_CLASS}
      />
      {preview && (
        <p
          id={previewId}
          className={`mt-1 text-xs ${parsed.ok ? 'text-charcoal/60' : 'text-sienna'}`}
        >
          {preview}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-sienna">
          {error}
        </p>
      )}
    </div>
  );
}

interface Props {
  values: { twitter: string; instagram: string; website: string };
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (field: 'twitter' | 'instagram' | 'website', value: string) => void;
}

// The three social-link inputs for the profile-settings form (TOV-35). X/Instagram take a bare handle and
// preview the URL that will be stored; website is a plain https URL. Per-field errors are keyed by the
// backend's dotted path (socialLinks.twitter, …) — the parent supplies the curated copy.
export default function SocialLinksFields({ values, errors, disabled, onChange }: Props) {
  const websiteError = errors['socialLinks.website'];
  const websiteErrorId = 'profile-website-error';

  return (
    <div className="space-y-5">
      <HandleField
        platform="twitter"
        label="X (Twitter)"
        placeholder="yourhandle"
        value={values.twitter}
        error={errors['socialLinks.twitter']}
        disabled={disabled}
        onChange={(v) => onChange('twitter', v)}
      />
      <HandleField
        platform="instagram"
        label="Instagram"
        placeholder="yourhandle"
        value={values.instagram}
        error={errors['socialLinks.instagram']}
        disabled={disabled}
        onChange={(v) => onChange('instagram', v)}
      />
      <div>
        <label htmlFor="profile-website" className="mb-2 block text-sm font-medium text-charcoal">
          Website
        </label>
        <input
          id="profile-website"
          type="url"
          inputMode="url"
          value={values.website}
          disabled={disabled}
          onChange={(e) => onChange('website', e.target.value)}
          placeholder="https://example.com"
          aria-invalid={websiteError ? true : undefined}
          aria-describedby={websiteError ? websiteErrorId : undefined}
          className={PROFILE_FIELD_CLASS}
        />
        {websiteError && (
          <p id={websiteErrorId} role="alert" className="mt-1 text-sm text-sienna">
            {websiteError}
          </p>
        )}
      </div>
    </div>
  );
}
