import { SocialLinks } from './constants/social-links.constant';

/**
 * A partial update to a user's profile columns (TOV-30). Only the keys present in the PATCH body appear;
 * an explicit `null` clears the column, an absent key leaves it unchanged. Built by `validateAndBuildPatch`
 * from the raw body keys (never from the DTO instance — that breaks under `useDefineForClassFields`/SWC).
 */
export interface ProfilePatch {
  bio?: string | null;
  statement?: string | null;
  socialLinks?: SocialLinks | null;
  profileImageId?: string | null;
}

/** Projected read of a user's profile fields for the `me` / `auth/profile` view (no secret columns). */
export interface UserProfileFields {
  id: string;
  email: string | null;
  handle: string | null;
  bio: string | null;
  statement: string | null;
  socialLinks: SocialLinks | null;
  profileImageId: string | null;
}
