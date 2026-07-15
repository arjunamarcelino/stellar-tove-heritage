import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { IUserRepository, USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';
import {
  HANDLE_HISTORY_REPOSITORY,
  IHandleHistoryRepository,
} from '@modules/users/repositories/handle-history-repository.interface';
import { User } from '@modules/users/entities/user.entity';
import { MAX_HANDLE_LENGTH } from '@modules/users/handle/handle-format';
import { CollectorProfileResponseDto } from './dto/collector-profile-response.dto';

/**
 * Public collector profile surface (TOV-27, FR-01.06). Resolves the CURRENT handle only
 * (case-insensitive); old handles are NOT aliases → 404. `previousHandles` is built from the append-only
 * handle_history, deduped by canonical, newest-first, excluding the current handle — and suppressed to `[]`
 * when the collector opted out (`handle_history_public = false`).
 */
@Injectable()
export class CollectorsService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(HANDLE_HISTORY_REPOSITORY) private readonly history: IHandleHistoryRepository,
  ) {}

  async getProfile(rawHandle: string): Promise<CollectorProfileResponseDto> {
    // trim ends + lowercase → the canonical key. JS toLowerCase() agrees with Postgres lower() (which
    // generated handle_canonical) because stored handles are ASCII (format-validated on write) — the same
    // equivalence the write path relies on (handle.service.ts). Load-bearing: it feeds findByHandleCanonical.
    const canonical = rawHandle.trim().toLowerCase();
    // Length short-circuit: an over-long handle can never match a stored one. 404 (identical to any other
    // miss — no existence oracle) without a DB round-trip.
    if (canonical.length > MAX_HANDLE_LENGTH) {
      throw failHttp(ErrorCode.COLLECTOR_NOT_FOUND, HttpStatus.NOT_FOUND, 'Collector not found');
    }
    const user = await this.users.findPublicProfileByHandleCanonical(canonical); // projected: no secret columns
    // Fail closed: a row matched via the generated handle_canonical MUST have a non-null handle; if not,
    // treat as not-found rather than asserting. Old / unknown / soft-deleted all return this same 404.
    if (!user?.handle) {
      throw failHttp(ErrorCode.COLLECTOR_NOT_FOUND, HttpStatus.NOT_FOUND, 'Collector not found');
    }
    const previousHandles = user.handleHistoryPublic ? await this.buildPreviousHandles(user) : [];
    // Member-since DATE only (UTC YYYY-MM-DD), not a ms timestamp — a full signup instant is an unnecessary
    // fingerprint/oracle on a public pseudonymous surface (TOV-27 review, todo 179).
    const createdAt = user.createdAt.toISOString().slice(0, 10);
    return { handle: user.handle, previousHandles, createdAt };
  }

  /** Distinct prior handles (by canonical), newest occurrence first, excluding the current canonical. */
  private async buildPreviousHandles(user: User): Promise<string[]> {
    // `handleCanonical` is `string | null` on the entity, but a handle-bearing row always has the
    // DB-generated canonical. Narrow it here so the current-handle exclusion below is type-GUARANTEED (not
    // safe-by-coincidence): if it were ever null the `=== currentCanonical` check couldn't exclude the
    // current handle and it would leak into previousHandles. Fail safe to [] in that impossible case.
    const currentCanonical = user.handleCanonical;
    if (!currentCanonical) return [];
    const rows = await this.history.listByUserId(user.id); // newest-first, capped
    const seen = new Set<string>();
    const previousHandles: string[] = [];
    for (const row of rows) {
      if (row.handleCanonical === currentCanonical) continue; // exclude ALL current-canonical rows
      if (seen.has(row.handleCanonical)) continue; // dedup, keep most-recent occurrence
      seen.add(row.handleCanonical);
      previousHandles.push(row.handle); // display-cased
    }
    return previousHandles;
  }
}
