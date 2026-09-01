import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MeProfile, UpdateProfileResult } from '@/lib/types/api';

const h = vi.hoisted(() => ({ updateProfileAction: vi.fn() }));
vi.mock('@/app/actions/profile', () => ({ updateProfileAction: h.updateProfileAction }));

import { useProfileForm } from '@/hooks/useProfileForm';
import {
  PROFILE_FIELD_MESSAGES,
  PROFILE_UPDATE_MESSAGES,
} from '@/lib/profile/profileSettingsMessages';

const PROFILE: MeProfile = {
  id: 'u1',
  email: 'leonardo@example.com',
  handle: 'leonardo',
  bio: 'Painter.',
  statement: null,
  socialLinks: null,
  profileImage: null,
};

function setup(overrides?: Partial<MeProfile>) {
  const onSaved = vi.fn();
  const onSessionExpired = vi.fn();
  const initial = { ...PROFILE, ...overrides };
  const { result } = renderHook(() => useProfileForm(initial, { onSaved, onSessionExpired }));
  return { result, onSaved, onSessionExpired };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useProfileForm', () => {
  it('seeds values from the profile and starts clean', () => {
    const { result } = setup();
    expect(result.current.values).toEqual({
      bio: 'Painter.',
      statement: '',
      twitter: '',
      instagram: '',
      website: '',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('becomes dirty when a field diverges from the snapshot', () => {
    const { result } = setup();
    act(() => result.current.setValue('bio', 'Sculptor.'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);
  });

  it('gates canSave off when the form is dirty but invalid (bio too long)', () => {
    const { result } = setup();
    act(() => result.current.setValue('bio', 'a'.repeat(301)));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(false);
  });

  it('gates canSave off for an invalid non-empty handle even when otherwise dirty', () => {
    const { result } = setup();
    // A bio change makes the form dirty; the invalid handle must still block Save via the validity gate.
    act(() => result.current.setValue('bio', 'Sculptor.'));
    act(() => result.current.setValue('twitter', '!!nope!!'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(false);
  });

  it('does not call the action on an empty (non-dirty) save', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.save();
    });
    expect(h.updateProfileAction).not.toHaveBeenCalled();
  });

  it('sends only the changed key in the patch', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'success',
      profile: { ...PROFILE, bio: 'Sculptor.' },
    } satisfies UpdateProfileResult);
    const { result } = setup();
    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });
    expect(h.updateProfileAction).toHaveBeenCalledTimes(1);
    expect(h.updateProfileAction).toHaveBeenCalledWith({ bio: 'Sculptor.' });
  });

  it('re-seeds the baseline from the SERVER-echoed profile on success', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'success',
      // Server canonicalizes the value — the form must reflect the server echo, not the local edit.
      profile: { ...PROFILE, bio: 'Server canonical bio.' },
    } satisfies UpdateProfileResult);
    const { result, onSaved } = setup();

    act(() => result.current.setValue('bio', 'Locally typed bio.'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('saved');
    expect(result.current.values.bio).toBe('Server canonical bio.');
    expect(result.current.dirty).toBe(false);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Server canonical bio.' }));
  });

  it('maps VALIDATION_FAILED to CURATED field copy, never the backend string', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'raw backend message',
      fieldPaths: ['bio', 'socialLinks.twitter'],
    } satisfies UpdateProfileResult);
    const { result } = setup();

    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.fieldErrors.bio).toBe(PROFILE_FIELD_MESSAGES.bio);
    expect(result.current.fieldErrors['socialLinks.twitter']).toBe(
      PROFILE_FIELD_MESSAGES['socialLinks.twitter'],
    );
    expect(result.current.fieldErrors.bio).not.toContain('BACKEND RAW');
    expect(result.current.errorMessage).toBeNull();
  });

  it('shows a form-level banner for VALIDATION_FAILED with no per-field errors (#222)', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'raw backend message',
      // no fieldErrors (e.g. a default NestJS 400)
    } satisfies UpdateProfileResult);
    const { result } = setup();

    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.fieldErrors).toEqual({});
    // Not left silent: a curated validation banner is shown instead of nothing.
    expect(result.current.errorMessage).toBe(PROFILE_UPDATE_MESSAGES.VALIDATION_FAILED);
  });

  it('calls onSessionExpired on a SESSION_EXPIRED error', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'expired',
    } satisfies UpdateProfileResult);
    const { result, onSessionExpired } = setup();

    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('surfaces a curated errorMessage for a transport error', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'boom',
    } satisfies UpdateProfileResult);
    const { result } = setup();

    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.errorMessage).not.toBe('boom');
  });

  it('clears the field error and returns to idle when the field is edited', async () => {
    h.updateProfileAction.mockResolvedValue({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'raw',
      fieldPaths: ['bio'],
    } satisfies UpdateProfileResult);
    const { result } = setup();

    act(() => result.current.setValue('bio', 'Sculptor.'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.fieldErrors.bio).toBeTruthy();

    act(() => result.current.setValue('bio', 'Sculptor!'));
    expect(result.current.fieldErrors.bio).toBeUndefined();
    expect(result.current.status).toBe('idle');
  });

  it('discard resets values to the snapshot and sends no action', async () => {
    const { result } = setup();
    act(() => result.current.setValue('bio', 'Changed.'));
    act(() => result.current.setValue('twitter', 'leonardo'));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.values).toEqual({
      bio: 'Painter.',
      statement: '',
      twitter: '',
      instagram: '',
      website: '',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.save();
    });
    expect(h.updateProfileAction).not.toHaveBeenCalled();
  });
});
