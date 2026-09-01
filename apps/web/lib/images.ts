// Single source of truth for the image-optimizer allowlist (TOV-190 review #190/#192). The public Supabase
// Storage origin was previously hard-copied into next.config.ts, both image components, and the artwork page —
// four copies that had to stay in lockstep or `isOptimizable` would green-light a host `remotePatterns` rejects,
// throwing the un-catchable "hostname not configured" error at SSR. Deriving it once here removes that drift.
//
// Importable from anywhere (no 'server-only'/'use client'): consumed by next.config.ts (build), the RSC page
// (preconnect), and the 'use client' image components. `NEXT_PUBLIC_*` is inlined into the client bundle at
// build, so the derivation is stable across contexts.

const DEFAULT_SUPABASE_URL = 'https://vasihtrobeqxooujcryw.supabase.co';

function resolveImageUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (raw) {
    try {
      return new URL(raw);
    } catch {
      // fall through to the default on a malformed override
    }
  }
  return new URL(DEFAULT_SUPABASE_URL);
}

const imageUrl = resolveImageUrl();

// Always a real string (the default is a valid URL), so consumers never juggle a null host/origin.
export const IMAGE_ORIGIN = imageUrl.origin;
export const ALLOWED_IMAGE_HOST = imageUrl.host;

// The public-object path prefix that next.config `remotePatterns` allows (`/storage/v1/object/public/**`),
// with no query string. `isOptimizable` mirrors the remotePattern EXACTLY so the gate can never disagree with
// what the Next optimizer will actually accept.
export const PUBLIC_OBJECT_PATH_PREFIX = '/storage/v1/object/public/';

// True only for URLs the optimizer will accept: the allowlisted host, a public-object path, and NO query
// string. A same-host SIGNED object (`/storage/v1/object/sign/…?token=…`) differs by path + query, so it is
// correctly rejected here → the caller renders it `unoptimized` (direct <img>) instead of hitting an optimizer
// 400 that would silently degrade to a placeholder.
export function isOptimizable(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.host === ALLOWED_IMAGE_HOST &&
      u.pathname.startsWith(PUBLIC_OBJECT_PATH_PREFIX) &&
      u.search === ''
    );
  } catch {
    return false;
  }
}
