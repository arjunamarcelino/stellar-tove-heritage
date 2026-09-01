'use client';

import { useEffect, useRef, useState } from 'react';
import type { MeProfile } from '@/lib/types/api';
import {
  type ProfileFormValues,
  profileToFormValues,
  buildProfilePatch,
  parseHandle,
  websiteUrlSchema,
} from '@/lib/profile/settingsSchemas';
import { BIO_MAX_LENGTH, STATEMENT_MAX_LENGTH } from '@/lib/profile/settingsConstants';
import {
  PROFILE_UPDATE_MESSAGES,
  PROFILE_FIELD_MESSAGES,
  PROFILE_FIELD_FALLBACK_MESSAGE,
} from '@/lib/profile/profileSettingsMessages';
import { updateProfileAction } from '@/app/actions/profile';

export type ProfileFormStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Options {
  onSaved: (profile: MeProfile) => void;
  onSessionExpired: () => void;
}

export interface UseProfileFormReturn {
  values: ProfileFormValues;
  setValue: (field: keyof ProfileFormValues, value: string) => void;
  dirty: boolean;
  status: ProfileFormStatus;
  errorMessage: string | null;
  fieldErrors: Record<string, string>;
  canSave: boolean;
  save: () => Promise<void>;
  discard: () => void;
}

// Maps a form field to the backend's dotted error path — so editing a field clears the RIGHT inline error,
// and so a 422 `fieldErrors` path lines up with the field it belongs to.
const FIELD_PATHS: Record<keyof ProfileFormValues, string> = {
  bio: 'bio',
  statement: 'statement',
  twitter: 'socialLinks.twitter',
  instagram: 'socialLinks.instagram',
  website: 'socialLinks.website',
};

// The client-side pre-flight gate (the backend re-validates as the real authority): length caps + a website
// that's empty-or-valid-https + every non-empty handle parseHandle-ok. Save is disabled until this passes.
function isFormValid(v: ProfileFormValues): boolean {
  if (v.bio.length > BIO_MAX_LENGTH) return false;
  if (v.statement.length > STATEMENT_MAX_LENGTH) return false;
  if (v.website.trim() !== '' && !websiteUrlSchema.safeParse(v.website).success) return false;
  if (v.twitter.trim() !== '' && !parseHandle(v.twitter, 'twitter').ok) return false;
  if (v.instagram.trim() !== '' && !parseHandle(v.instagram, 'instagram').ok) return false;
  return true;
}

// Owns the editable profile-settings form (TOV-35 / FR-01.09): a diff-against-baseline dirty check, a
// client-side validity gate, and the save round-trip. The baseline is a MeProfile snapshot; on a successful
// save it is replaced with the SERVER-ECHOED profile (never the local values) so the form re-seeds from the
// authority and lands clean. A busyRef guards double-submit; a cancelledRef drops post-unmount setState.
export function useProfileForm(initialProfile: MeProfile, opts: Options): UseProfileFormReturn {
  // Mount-seeded from the SSR prop and thereafter owned client-side (re-seeded from the save echo). A later
  // change to the `initialProfile` prop is NOT reconciled — intentional, as no router.refresh() drives this
  // surface today; the save echo is the only baseline update path.
  const [snapshot, setSnapshot] = useState<MeProfile>(initialProfile);
  const [values, setValues] = useState<ProfileFormValues>(() =>
    profileToFormValues(initialProfile),
  );
  const [status, setStatus] = useState<ProfileFormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const patch = buildProfilePatch(values, snapshot);
  const dirty = Object.keys(patch).length > 0;
  const canSave = dirty && status !== 'saving' && isFormValid(values);

  function setValue(field: keyof ProfileFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Editing anything returns the form to a neutral state and clears that field's inline error.
    setStatus('idle');
    setErrorMessage(null);
    setFieldErrors((prev) => {
      const path = FIELD_PATHS[field];
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }

  async function save() {
    if (busyRef.current) return;
    if (!canSave) return; // covers not-dirty + invalid
    const nextPatch = buildProfilePatch(values, snapshot);
    if (Object.keys(nextPatch).length === 0) return; // no-op: nothing to send

    busyRef.current = true;
    setStatus('saving');
    setErrorMessage(null);
    try {
      const result = await updateProfileAction(nextPatch);
      if (cancelledRef.current) return;

      if (result.status === 'success') {
        // Server-echo baseline: re-seed from the returned profile so the form is authoritative + clean.
        setSnapshot(result.profile);
        setValues(profileToFormValues(result.profile));
        setFieldErrors({});
        setErrorMessage(null);
        setStatus('saved');
        opts.onSaved(result.profile);
        return;
      }

      if (result.code === 'VALIDATION_FAILED') {
        // Use the dotted path ONLY as a key into the curated copy — never render the backend string.
        const mapped: Record<string, string> = {};
        for (const path of result.fieldPaths ?? []) {
          mapped[path] = PROFILE_FIELD_MESSAGES[path] ?? PROFILE_FIELD_FALLBACK_MESSAGE;
        }
        setFieldErrors(mapped);
        // If the backend didn't itemize fields (e.g. a default NestJS 400 with no errors[]), show a
        // form-level validation banner so the user isn't left with zero feedback (#222).
        setErrorMessage(
          Object.keys(mapped).length === 0 ? PROFILE_UPDATE_MESSAGES.VALIDATION_FAILED : null,
        );
        setStatus('error');
        return;
      }

      if (result.code === 'SESSION_EXPIRED') {
        setStatus('idle');
        opts.onSessionExpired();
        return;
      }

      setErrorMessage(PROFILE_UPDATE_MESSAGES[result.code]);
      setStatus('error');
    } finally {
      busyRef.current = false;
    }
  }

  function discard() {
    setValues(profileToFormValues(snapshot));
    setFieldErrors({});
    setErrorMessage(null);
    setStatus('idle');
  }

  return {
    values,
    setValue,
    dirty,
    status,
    errorMessage,
    fieldErrors,
    canSave,
    save,
    discard,
  };
}
