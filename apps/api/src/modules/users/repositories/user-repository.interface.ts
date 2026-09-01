import { KycStatus } from '@common/enums/kyc-status.enum';
import { User } from '../entities/user.entity';
import { ProfilePatch, UserProfileFields } from '../profile/profile.types';

/**
 * DI token for {@link IUserRepository}. Const form (matches `WALLET_REPOSITORY` et al.) so injection
 * sites reference a symbol instead of a stringly-typed magic string. Value is unchanged (`'IUserRepository'`),
 * so any provider still registering the raw string resolves to the same token.
 */
export const USER_REPOSITORY = 'IUserRepository';

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  // Handle uniqueness (TOV-26). Lookup is canonical (lowercase); TypeORM auto-scopes to live rows.
  findByHandleCanonical(canonical: string): Promise<User | null>;
  // Public collector profile (TOV-27): same canonical lookup, but PROJECTED to the fields the public read
  // needs (id + handle + handleCanonical + handleHistoryPublic + createdAt) so secret columns
  // (passwordHash, refreshTokenHash) are never hydrated for an anonymous request.
  findPublicProfileByHandleCanonical(canonical: string): Promise<User | null>;
  // Projected read of just the caller's handle — avoids hydrating secret columns (passwordHash,
  // refreshTokenHash) for GET /me/handle. Returns null when no live user matches.
  findHandleByUserId(userId: string): Promise<{ handle: string | null } | null>;
  // Projected read of just the caller's whitelist (kyc) status — the bid whitelist gate (TOV-156). Avoids
  // hydrating secret/compliance columns. Returns null when no live user matches.
  findKycStatusByUserId(userId: string): Promise<{ kycStatus: KycStatus } | null>;
  // Sets the caller's display handle and, on a real change, appends a handle_history row — atomically
  // (TOV-27). The DB regenerates handle_canonical. Returns false when no live row matched
  // (soft-deleted/absent). May throw a 23505 unique violation for the caller to map.
  setHandle(userId: string, handle: string): Promise<boolean>;
  // Sets the collector's handle-history public/opt-out flag (TOV-27). Returns false when no live row matched.
  setHistoryVisibility(userId: string, isPublic: boolean): Promise<boolean>;
  // Profile fields (TOV-30). Projected read (no secret columns) for GET /me + auth/profile.
  findProfileFieldsByUserId(userId: string): Promise<UserProfileFields | null>;
  // Column-scoped partial update of the present profile columns (avoids clobbering concurrent field edits;
  // skips @BeforeUpdate hooks, which only guard email/passwordHash). Empty patch is a no-op. Returns false
  // when no live row matched.
  updateProfileFields(userId: string, patch: ProfilePatch): Promise<boolean>;
  // Set the active avatar ONLY if the image is still owned, `ready`, and not soft-deleted — atomically, so a
  // concurrent delete can't leave profile_image_id pointing at a deleted image. Returns false if it didn't take.
  activateAvatar(userId: string, imageId: string): Promise<boolean>;
}
