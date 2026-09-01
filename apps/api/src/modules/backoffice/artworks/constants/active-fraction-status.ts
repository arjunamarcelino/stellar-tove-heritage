import { HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { FractionContractStatus } from '@modules/fractionalization/entities/fraction-contract.entity';

const logger = new Logger('assertActiveStatus');

/**
 * The non-`failed` contract states surfaced by the admin **active-only** projection (TOV-240). Single
 * source of truth for the runtime tuple (Swagger `enum`) AND the derived `ActiveFractionStatus` type.
 * This is shared read-model infra (a type + narrowing guard), not an I/O DTO, so it lives under
 * `constants/` rather than `dto/`.
 */
export const ACTIVE_FRACTION_STATUSES = ['deploying', 'deployed'] as const;

export type ActiveFractionStatus = (typeof ACTIVE_FRACTION_STATUSES)[number];

/**
 * Runtime narrowing guard for the projected contract status. `fraction_contracts.status` is a `varchar`
 * that TypeORM does NOT validate against the TS union, so a drifted/`failed` value reaching a DTO narrowed
 * to `deploying|deployed` would otherwise require an `as` cast that silently ships a lie. The active-only
 * finders already exclude `failed`; this guard *earns* the narrow type and fails loud (500) if a corrupt
 * row ever slips through, instead of emitting an out-of-contract response. The offending value is logged
 * server-side; the 500 body is generic so a drifted internal DB value is never echoed to the client.
 */
export function assertActiveStatus(status: FractionContractStatus): ActiveFractionStatus {
  if (status === 'deploying' || status === 'deployed') return status;
  logger.error(`Unexpected non-active contract status "${status}" in active projection`);
  throw failHttp(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
}
