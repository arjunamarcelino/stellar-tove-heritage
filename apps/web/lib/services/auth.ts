import 'server-only';

import { cache } from 'react';
import { z } from 'zod/v4';
import type { RegisterState, LoginServiceResult, ProfileResult } from '@/lib/types/api';
import { postJson, extractBackendMessage, extractFieldErrors } from '@/lib/services/http';

interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

// Calls the Express backend to register a new user.
// Replace with real token handling (e.g. HTTP-only cookies) when auth flow is finalised.
export async function registerUser(payload: RegisterPayload): Promise<RegisterState> {
  if (!process.env.API_BASE_URL) {
    return { status: 'error', message: 'Server configuration error' };
  }

  const outcome = await postJson('/v1/auth/register', payload);
  if (!outcome.ok) {
    if (outcome.status === 0) {
      return { status: 'error', message: 'Unable to reach the authentication service' };
    }
    return {
      status: 'error',
      message: extractBackendMessage(outcome.data, 'Registration failed'),
      fieldErrors: extractFieldErrors(outcome.data),
    };
  }

  // TODO: persist tokens server-side (HTTP-only cookie) before returning
  return { status: 'success' };
}

// ── Login ──────────────────────────────────────────

interface LoginPayload {
  email: string;
  password: string;
}

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

// ── Profile ───────────────────────────────────────

export const stageSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  order: z.number(),
  isActive: z.boolean(),
  startsAt: z.string().nullable(),
  isEffectivelyActive: z.boolean(),
  totalMissions: z.number(),
  completedMissions: z.number(),
  isCompleted: z.boolean(),
});

const profileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  currentStage: stageSchema.nullish(),
});

export type Stage = z.infer<typeof stageSchema>;

export const fetchProfile = cache(async function fetchProfile(
  accessToken: string,
): Promise<ProfileResult> {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) return { status: 'error', message: 'Server configuration error' };

  try {
    const res = await fetch(`${apiBaseUrl}/v1/auth/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return { status: 'error', message: 'Failed to fetch profile' };

    const data: unknown = await res.json();
    const parsed = profileSchema.safeParse(data);
    if (!parsed.success) return { status: 'error', message: 'Invalid profile response' };

    return {
      status: 'success',
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      currentStage: parsed.data.currentStage,
    };
  } catch {
    return { status: 'error', message: 'Unable to reach the authentication service' };
  }
});

export async function loginUser(payload: LoginPayload): Promise<LoginServiceResult> {
  if (!process.env.API_BASE_URL) {
    return { status: 'error', message: 'Server configuration error' };
  }

  const outcome = await postJson('/v1/auth/login', payload);
  if (!outcome.ok) {
    if (outcome.status === 401 || outcome.status === 403) {
      return { status: 'error', message: 'Invalid email or password' };
    }
    if (outcome.status === 429) {
      return { status: 'error', message: 'Too many attempts. Please try again later.' };
    }
    if (outcome.status === 0) {
      return { status: 'error', message: 'Unable to reach the authentication service' };
    }
    return {
      status: 'error',
      message: extractBackendMessage(outcome.data, 'Login failed'),
      fieldErrors: extractFieldErrors(outcome.data),
    };
  }

  const tokens = tokenResponseSchema.safeParse(outcome.data);
  if (!tokens.success) {
    return { status: 'error', message: 'Unexpected server response' };
  }

  return {
    status: 'success',
    accessToken: tokens.data.accessToken,
    refreshToken: tokens.data.refreshToken,
  };
}
