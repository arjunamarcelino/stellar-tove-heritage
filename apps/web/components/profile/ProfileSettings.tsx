'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeProfile, ProfileImageUrls } from '@/lib/types/api';
import { useProfileForm } from '@/hooks/useProfileForm';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import CharCounter from '@/components/profile/CharCounter';
import SocialLinksFields from '@/components/profile/SocialLinksFields';
import AvatarUploader from '@/components/profile/AvatarUploader';
import Toast from '@/components/ui/Toast';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS } from '@/components/ui/surfaces';
import { PROFILE_FIELD_CLASS } from '@/components/profile/fieldClasses';
import { BIO_MAX_LENGTH, STATEMENT_MAX_LENGTH } from '@/lib/profile/settingsConstants';

function displayName(profile: MeProfile): string {
  return profile.handle ?? profile.email ?? 'You';
}

interface Props {
  profile: MeProfile;
}

// Client orchestrator for the profile-settings page (TOV-35 / FR-01.09). The persisted state has three
// independently-owned slices that are never cross-read, so the two `PATCH /me` flows can't clobber each
// other: the text fields live in `useProfileForm` (re-seeded from its own save echo), the avatar image in
// `useAvatarUpload` (`activeImage`), and the display name derives from the immutable handle/email of the
// SSR-seeded `profile` (not editable here). Both flows surface SESSION_EXPIRED up to a single /login redirect.
// The `profile` prop is intentionally mount-seeded (no router.refresh() drives this surface today).
export default function ProfileSettings({ profile }: Props) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A monotonic id per toast so an identical repeated message (e.g. saving twice) still re-mounts <Toast>
  // via its `key` and re-arms the dismiss timer, instead of inheriting the previous countdown (#227).
  const toastSeqRef = useRef(0);
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  function showToast(message: string, tone: 'success' | 'error') {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, tone });
  }

  // Move focus to the page heading on mount (screen-reader orientation), mirroring KycWizard.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const goToLogin = () => router.replace('/login');

  const form = useProfileForm(profile, {
    onSaved: () => showToast('Profile updated', 'success'),
    onSessionExpired: goToLogin,
  });

  const avatar = useAvatarUpload(profile.profileImage, {
    onAvatarActivated: (image: ProfileImageUrls | null) =>
      showToast(image ? 'Photo updated' : 'Photo removed', 'success'),
    onSessionExpired: goToLogin,
  });

  const name = displayName(profile);
  const saving = form.status === 'saving';

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-3xl text-charcoal outline-none"
      >
        Profile
      </h1>
      <p className="mt-2 text-sm text-charcoal/60">Edit how you appear across Tove.</p>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-charcoal">Profile photo</h2>
        <div className="mt-3">
          <AvatarUploader
            state={avatar.state}
            previewUrl={avatar.previewUrl}
            activeImage={avatar.activeImage}
            name={name}
            onSelectFile={avatar.selectFile}
            onRemove={avatar.removeAvatar}
            onRetry={avatar.retry}
          />
        </div>
      </div>

      <form
        className="mt-10 space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          void form.save();
        }}
      >
        <div>
          <label htmlFor="profile-bio" className="mb-2 block text-sm font-medium text-charcoal">
            Bio
          </label>
          <textarea
            id="profile-bio"
            rows={3}
            value={form.values.bio}
            disabled={saving}
            onChange={(e) => form.setValue('bio', e.target.value)}
            aria-invalid={form.fieldErrors.bio ? true : undefined}
            aria-describedby="profile-bio-counter"
            className={PROFILE_FIELD_CLASS}
          />
          <div className="mt-1 flex items-start justify-between gap-4">
            {form.fieldErrors.bio ? (
              <p role="alert" className="text-sm text-sienna">
                {form.fieldErrors.bio}
              </p>
            ) : (
              <span />
            )}
            <CharCounter id="profile-bio-counter" value={form.values.bio} max={BIO_MAX_LENGTH} />
          </div>
        </div>

        <div>
          <label
            htmlFor="profile-statement"
            className="mb-2 block text-sm font-medium text-charcoal"
          >
            Statement
          </label>
          <textarea
            id="profile-statement"
            rows={5}
            value={form.values.statement}
            disabled={saving}
            onChange={(e) => form.setValue('statement', e.target.value)}
            aria-invalid={form.fieldErrors.statement ? true : undefined}
            aria-describedby="profile-statement-counter"
            className={PROFILE_FIELD_CLASS}
          />
          <div className="mt-1 flex items-start justify-between gap-4">
            {form.fieldErrors.statement ? (
              <p role="alert" className="text-sm text-sienna">
                {form.fieldErrors.statement}
              </p>
            ) : (
              <span />
            )}
            <CharCounter
              id="profile-statement-counter"
              value={form.values.statement}
              max={STATEMENT_MAX_LENGTH}
            />
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-charcoal">Social links</h2>
          <SocialLinksFields
            values={{
              twitter: form.values.twitter,
              instagram: form.values.instagram,
              website: form.values.website,
            }}
            errors={form.fieldErrors}
            disabled={saving}
            onChange={(field, value) => form.setValue(field, value)}
          />
        </div>

        {form.errorMessage && (
          <p role="alert" className={ERROR_CLASS}>
            {form.errorMessage}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className={PRIMARY_BUTTON} disabled={!form.canSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={form.discard}
            disabled={!form.dirty || saving}
          >
            Discard
          </button>
        </div>
      </form>

      {/* Polite status for the text-save lifecycle, distinct from the avatar uploader's own live regions. */}
      <p className="sr-only" role="status" aria-live="polite">
        {form.status === 'saving'
          ? 'Saving your profile…'
          : form.status === 'saved'
            ? 'Profile saved.'
            : ''}
      </p>

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}
    </section>
  );
}
