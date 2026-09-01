import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { TimelineEventType } from './constants/timeline-event.constant';
import type {
  FractionalizationEventData,
  SecondaryTradeEventData,
  TimelineEventData,
} from './types/timeline-event-data';

interface EmitRow {
  artworkId: string;
  eventType: TimelineEventType;
  occurredAt: Date;
  summary: string | null;
  eventData: TimelineEventData;
  sourceRef: string;
}

/**
 * Best-effort, post-commit timeline event writer (TOV-191), modeled on `AuditLogService.record`. A failed
 * emit is LOGGED, never thrown — it must never roll back or block the deploy/settlement it describes.
 * Idempotent via `ON CONFLICT (source_ref) DO NOTHING` (the FULL-unique belt), so a BullMQ retry / reconcile
 * re-drive never double-writes. Emits are unconditional post-commit; idempotency handles the double-fire.
 */
@Injectable()
export class TimelineEmitService {
  private readonly logger = new Logger(TimelineEmitService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Fractionalization deploy success. `txHash` is the system contract-deploy tx (no counterparty). */
  async emitFractionalizationDeployed(input: {
    artworkId: string;
    fractionContractId: string;
    tokenAddress: string;
    deployLedger: string | null;
    txHash: string | null;
  }): Promise<void> {
    const eventData: FractionalizationEventData = {
      tokenAddress: input.tokenAddress,
      deployLedger: input.deployLedger,
      ...(input.txHash ? { txHash: input.txHash } : {}),
    };
    await this.insert({
      artworkId: input.artworkId,
      eventType: 'fractionalization',
      occurredAt: new Date(),
      summary: 'Artwork fractionalized into fraction tokens',
      eventData,
      sourceRef: `fractionalization:${input.fractionContractId}`,
    });
  }

  /**
   * Secondary-trade settlement. `SecondaryTrade` has no `artwork_id`, so resolve it from `fraction_contracts`.
   * `txHash` is deliberately NOT included (deanonymizes counterparties — resolved Open Q1).
   */
  async emitSecondaryTradeSettled(input: {
    tradeId: string;
    fractionContractId: string;
    fractionCount: string;
    pricePerFractionStroops: string;
  }): Promise<void> {
    const artworkId = await this.resolveArtworkId(input.fractionContractId);
    if (!artworkId) {
      this.logger.warn(
        `timeline emit skipped: no artwork_id for fraction_contract ${input.fractionContractId} (trade ${input.tradeId})`,
      );
      return;
    }
    const occurredAt = new Date();
    const eventData: SecondaryTradeEventData = {
      fractionCount: input.fractionCount,
      pricePerFractionStroops: input.pricePerFractionStroops,
      settledAt: occurredAt.toISOString(),
    };
    await this.insert({
      artworkId,
      eventType: 'secondary_trade',
      occurredAt,
      summary: `${input.fractionCount} fractions traded`,
      eventData,
      sourceRef: `secondary_trade:${input.tradeId}`,
    });
  }

  private async resolveArtworkId(fractionContractId: string): Promise<string | null> {
    // Guarded so a transient DB error here NEVER throws out of emit — otherwise it would propagate out of
    // the post-commit `persistSettled` and spuriously fail/retry an already-settled trade (review #401).
    try {
      const rows = await this.dataSource.query<Array<{ artwork_id: string }>>(
        `SELECT "artwork_id" FROM "fraction_contracts" WHERE "id" = $1 LIMIT 1`,
        [fractionContractId],
      );
      return rows[0]?.artwork_id ?? null;
    } catch (err) {
      this.logger.error(`timeline emit resolveArtworkId failed [fractionContract=${fractionContractId}]: ${String(err)}`);
      return null;
    }
  }

  private async insert(row: EmitRow): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO "artwork_timeline_events"
           ("artwork_id", "event_type", "is_published", "occurred_at", "summary", "event_data", "source_ref")
         VALUES ($1, $2, true, $3, $4, $5::jsonb, $6)
         ON CONFLICT ("source_ref") DO NOTHING`,
        [row.artworkId, row.eventType, row.occurredAt, row.summary, JSON.stringify(row.eventData), row.sourceRef],
      );
    } catch (err) {
      // Best-effort: a timeline write must never fail the money action that already committed.
      this.logger.error(
        `timeline emit failed [type=${row.eventType} ref=${row.sourceRef}]: ${String(err)}`,
      );
    }
  }
}
