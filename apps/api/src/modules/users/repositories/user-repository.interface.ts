import { User } from '../entities/user.entity';

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
  // Sets the caller's display handle and, on a real change, appends a handle_history row — atomically
  // (TOV-27). The DB regenerates handle_canonical. Returns false when no live row matched
  // (soft-deleted/absent). May throw a 23505 unique violation for the caller to map.
  setHandle(userId: string, handle: string): Promise<boolean>;
  // Sets the collector's handle-history public/opt-out flag (TOV-27). Returns false when no live row matched.
  setHistoryVisibility(userId: string, isPublic: boolean): Promise<boolean>;
}
