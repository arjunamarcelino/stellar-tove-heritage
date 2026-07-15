import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { IUserRepository, USER_REPOSITORY } from '../repositories/user-repository.interface';
import { isValidHandleFormat, RESERVED_HANDLES } from './handle-format';
import { SetHandleResponseDto } from './dto/set-handle-response.dto';
import { MyHandleResponseDto } from './dto/my-handle-response.dto';
import { CheckHandleResponseDto } from './dto/check-handle-response.dto';
import { SetHandleHistoryVisibilityDto } from './dto/set-handle-history-visibility.dto';

/**
 * Orchestrates the collector handle surface (TOV-26). Validation precedence — identical in both
 * endpoints — is `invalid_format → reserved → taken` (cheapest/structural first), so the public check
 * and the authenticated write never disagree. Uniqueness is enforced by the DB partial unique index;
 * a 23505 maps to 409 HANDLE_TAKEN. Idempotent self-reset needs no special-casing: Postgres never
 * conflicts a row's unique key against its own prior version.
 */
@Injectable()
export class HandleService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: IUserRepository) {}

  async check(raw: string): Promise<CheckHandleResponseDto> {
    const handle = raw.trim(); // trim ends only; internal whitespace is an illegal char (HANDLE_RE)
    if (!isValidHandleFormat(handle)) return { handle, available: false, reason: 'invalid_format' };
    const canonical = handle.toLowerCase(); // ASCII-only ⇒ agrees with Postgres lower() (see handle-format)
    if (RESERVED_HANDLES.has(canonical)) return { handle, available: false, reason: 'reserved' };
    const found = await this.users.findByHandleCanonical(canonical);
    return found ? { handle, available: false, reason: 'taken' } : { handle, available: true };
  }

  async setHandle(userId: string, raw: string): Promise<SetHandleResponseDto> {
    const handle = raw.trim(); // trim ends only; internal whitespace is an illegal char (HANDLE_RE)
    if (!isValidHandleFormat(handle)) {
      throw failHttp(ErrorCode.HANDLE_FORMAT_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid handle format');
    }
    const canonical = handle.toLowerCase();
    if (RESERVED_HANDLES.has(canonical)) {
      throw failHttp(ErrorCode.HANDLE_RESERVED, HttpStatus.UNPROCESSABLE_ENTITY, 'Handle is reserved');
    }
    try {
      const updated = await this.users.setHandle(userId, handle);
      // JWT sub ⇒ effectively unreachable, but fail loudly rather than silently 200 on a vanished user.
      if (!updated) throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    } catch (err) {
      // Map ONLY the unique violation. The static message never echoes the raw 23505 detail
      // (`Key (handle_canonical)=(maya) already exists`) — no owner disclosure.
      if (isUniqueConstraintError(err)) {
        throw failHttp(ErrorCode.HANDLE_TAKEN, HttpStatus.CONFLICT, 'Handle already taken');
      }
      throw err;
    }
    // canonical computed, not read back: repository.update() leaves the entity's generated column stale.
    return { handle, handleCanonical: canonical };
  }

  async getMyHandle(userId: string): Promise<MyHandleResponseDto> {
    const row = await this.users.findHandleByUserId(userId); // projected: no secret columns loaded
    if (!row) throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    return { handle: row.handle };
  }

  /** TOV-27: toggle whether the caller's handle history is shown on their public collector profile. */
  async setHistoryVisibility(userId: string, isPublic: boolean): Promise<SetHandleHistoryVisibilityDto> {
    const updated = await this.users.setHistoryVisibility(userId, isPublic);
    if (!updated) throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    return { public: isPublic }; // response echoes the (validated) request shape — one DTO for both
  }
}
