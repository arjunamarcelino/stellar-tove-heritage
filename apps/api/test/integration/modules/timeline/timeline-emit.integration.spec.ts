import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { TimelineEmitService } from '@modules/timeline/timeline-emit.service';
import {
  TIMELINE_EVENT_TYPES,
  tierForEventType,
} from '@modules/timeline/constants/timeline-event.constant';
import { insertArtwork, insertArtworkArtist } from '../../../shared/seed-artwork';

const ARTIST = '00000000-0000-4000-8000-0000000f2890';
const ART = '00000000-0000-4000-8000-0000000f2001';
const FC = '00000000-0000-4000-8000-0000000f2fc1';

async function insertFractionContract(
  q: (t: string, p?: unknown[]) => Promise<unknown[]>,
  id: string,
  artworkId: string,
): Promise<void> {
  await q(
    `INSERT INTO "fraction_contracts"
       ("id","artwork_id","status","wasm_hash","token_name","token_symbol","artist_address",
        "total_supply","artist_retention_pct","treasury_retention_pct","artist_lockup_days","treasury_lockup_days")
     VALUES ($1,$2,'deploying',$3,'Tok','TOK',$4,'10000',0,0,0,0)`,
    [id, artworkId, 'a'.repeat(64), 'G'.repeat(56)],
  );
}

describe('TimelineEmitService + schema invariants (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let emit: TimelineEmitService;

  beforeAll(async () => {
    moduleRef = await createTestingModule(TimelineModule);
    dataSource = moduleRef.get(DataSource);
    emit = moduleRef.get(TimelineEmitService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const q = (text: string, params?: unknown[]) => dataSource.query(text, params);

  beforeEach(async () => {
    await truncateTables(dataSource); // clears the registered artwork_timeline_events
    // Cascade-clear the tables the minimal module doesn't register (users → artworks → fraction_contracts).
    await q(`TRUNCATE TABLE "users" CASCADE`);
    await insertArtworkArtist(q, ARTIST);
    await insertArtwork(q, { id: ART, artistUserId: ARTIST, status: 'fractionalized' });
  });

  it('emitFractionalizationDeployed inserts one row, idempotent on re-drive (positive/edge)', async () => {
    const input = {
      artworkId: ART,
      fractionContractId: FC,
      tokenAddress: 'C'.repeat(56),
      deployLedger: '12345',
      txHash: 'deadbeef',
    };
    await emit.emitFractionalizationDeployed(input);
    await emit.emitFractionalizationDeployed(input); // reconcile / retry re-drive
    const rows = (await q(
      `SELECT event_type, visibility_tier, event_data, source_ref FROM artwork_timeline_events WHERE artwork_id=$1`,
      [ART],
    )) as Array<{ event_type: string; visibility_tier: string; event_data: Record<string, unknown>; source_ref: string }>;
    expect(rows).toHaveLength(1); // ON CONFLICT (source_ref) dedup
    expect(rows[0].event_type).toBe('fractionalization');
    expect(rows[0].visibility_tier).toBe('default');
    expect(rows[0].source_ref).toBe(`fractionalization:${FC}`);
    expect(rows[0].event_data).toMatchObject({ tokenAddress: 'C'.repeat(56), deployLedger: '12345', txHash: 'deadbeef' });
  });

  it('emitSecondaryTradeSettled resolves artwork_id from fraction_contracts, omits txHash (positive/negative)', async () => {
    await insertFractionContract(q, FC, ART);
    await emit.emitSecondaryTradeSettled({
      tradeId: '00000000-0000-4000-8000-0000000f2t01',
      fractionContractId: FC,
      fractionCount: '10',
      pricePerFractionStroops: '5000000',
    });
    const rows = (await q(
      `SELECT artwork_id, event_type, event_data FROM artwork_timeline_events WHERE event_type='secondary_trade'`,
    )) as Array<{ artwork_id: string; event_data: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].artwork_id).toBe(ART);
    expect(rows[0].event_data).toMatchObject({ fractionCount: '10', pricePerFractionStroops: '5000000' });
    expect(rows[0].event_data.txHash).toBeUndefined();
  });

  it('emit is best-effort: an unresolvable fraction_contract does not throw (negative)', async () => {
    await expect(
      emit.emitSecondaryTradeSettled({
        tradeId: '00000000-0000-4000-8000-0000000f2t02',
        fractionContractId: '00000000-0000-4000-8000-0000000f2ff9', // no such contract
        fractionCount: '1',
        pricePerFractionStroops: '1',
      }),
    ).resolves.toBeUndefined();
    const rows = (await q(`SELECT 1 FROM artwork_timeline_events`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('generated visibility_tier is FAIL-CLOSED and matches the TS tier map for every event type', async () => {
    for (const type of TIMELINE_EVENT_TYPES) {
      const rows = (await q(
        `INSERT INTO artwork_timeline_events (artwork_id, event_type, occurred_at)
         VALUES ($1,$2, now()) RETURNING visibility_tier`,
        [ART, type],
      )) as Array<{ visibility_tier: string }>;
      expect(rows[0].visibility_tier).toBe(tierForEventType(type));
    }
    // The confidentiality boundary cannot be set by a writer — expanded types resolve to 'expanded'.
    const admin = (await q(
      `SELECT visibility_tier FROM artwork_timeline_events WHERE event_type='admin_note' LIMIT 1`,
    )) as Array<{ visibility_tier: string }>;
    expect(admin[0].visibility_tier).toBe('expanded');
  });

  it('the freeze-list guard blocks provenance UPDATEs but allows the publish flip (edge)', async () => {
    const rows = (await q(
      `INSERT INTO artwork_timeline_events (artwork_id, event_type, occurred_at, is_published)
       VALUES ($1,'admin_note', now(), false) RETURNING id`,
      [ART],
    )) as Array<{ id: string }>;
    const id = rows[0].id;

    // Allowed: publish flip false → true.
    await expect(q(`UPDATE artwork_timeline_events SET is_published=true WHERE id=$1`, [id])).resolves.toBeDefined();

    // Blocked: mutating a frozen provenance column.
    await expect(q(`UPDATE artwork_timeline_events SET event_type='fractionalization' WHERE id=$1`, [id])).rejects.toThrow(
      /immutable columns cannot change/,
    );
    await expect(q(`UPDATE artwork_timeline_events SET occurred_at = now() WHERE id=$1`, [id])).rejects.toThrow(
      /immutable columns cannot change/,
    );
  });

  it('the guard blocks hard DELETE and soft-delete of provenance rows (#400, negative)', async () => {
    const rows = (await q(
      `INSERT INTO artwork_timeline_events (artwork_id, event_type, occurred_at, source_ref)
       VALUES ($1,'fractionalization', now(), 'del-guard-1') RETURNING id`,
      [ART],
    )) as Array<{ id: string }>;
    const id = rows[0].id;

    await expect(q(`DELETE FROM artwork_timeline_events WHERE id=$1`, [id])).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(q(`UPDATE artwork_timeline_events SET deleted_at = now() WHERE id=$1`, [id])).rejects.toThrow(
      /cannot be soft-deleted/,
    );
    // The row survived both attempts.
    const still = (await q(`SELECT 1 FROM artwork_timeline_events WHERE id=$1`, [id])) as unknown[];
    expect(still).toHaveLength(1);
  });
});
