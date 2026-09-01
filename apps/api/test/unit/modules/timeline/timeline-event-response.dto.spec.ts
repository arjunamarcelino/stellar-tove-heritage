import { describe, it, expect } from 'vitest';
import { TimelineEventResponseDto } from '@modules/timeline/dto/timeline-event-response.dto';
import type { TimelineEventRecord } from '@modules/timeline/repositories/timeline-read-repository.interface';

function record(over: Partial<TimelineEventRecord>): TimelineEventRecord {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    eventType: 'fractionalization',
    visibilityTier: 'default',
    occurredAt: new Date('2026-08-24T10:00:00.000Z'),
    summary: 'summary',
    eventData: {},
    ...over,
  };
}

describe('TimelineEventResponseDto.from — read-side PII allowlist', () => {
  it('maps camelCase fields and ISO occurredAt (positive)', () => {
    const dto = TimelineEventResponseDto.from(
      record({ eventData: { tokenAddress: 'C123', deployLedger: '500', txHash: 'abc' } }),
    );
    expect(dto.occurredAt).toBe('2026-08-24T10:00:00.000Z');
    expect(dto.eventType).toBe('fractionalization');
    expect(dto.visibilityTier).toBe('default');
    expect(dto.metadata).toEqual({ tokenAddress: 'C123', deployLedger: '500', txHash: 'abc' });
  });

  it('OMITS txHash from a secondary_trade payload (negative — deanonymization)', () => {
    const dto = TimelineEventResponseDto.from(
      record({
        eventType: 'secondary_trade',
        eventData: {
          fractionCount: '10',
          pricePerFractionStroops: '5000000',
          settledAt: '2026-08-24T10:00:00.000Z',
          txHash: 'LEAKED',
        },
      }),
    );
    expect(dto.metadata).toEqual({
      fractionCount: '10',
      pricePerFractionStroops: '5000000',
      settledAt: '2026-08-24T10:00:00.000Z',
    });
    expect(dto.metadata.txHash).toBeUndefined();
  });

  it('drops ANY non-allowlisted / PII key even if a writer regresses (negative, defense-in-depth)', () => {
    const dto = TimelineEventResponseDto.from(
      record({
        eventType: 'secondary_trade',
        eventData: {
          fractionCount: '10',
          pricePerFractionStroops: '5000000',
          settledAt: '2026-08-24T10:00:00.000Z',
          buyerSub: '00000000-0000-4000-8000-00000000b111',
          sellerSub: '00000000-0000-4000-8000-00000000b222',
          email: 'leak@example.com',
        },
      }),
    );
    for (const forbidden of ['buyerSub', 'sellerSub', 'email', 'sub', 'txHash']) {
      expect(dto.metadata[forbidden]).toBeUndefined();
    }
  });

  it('yields {} metadata for schema-only event types with no writer (edge)', () => {
    const dto = TimelineEventResponseDto.from(
      record({ eventType: 'admin_note', visibilityTier: 'expanded', eventData: { note: 'internal', author: 'x' } }),
    );
    expect(dto.metadata).toEqual({});
  });

  it('drops null/undefined allowlisted values (edge)', () => {
    const dto = TimelineEventResponseDto.from(
      record({ eventData: { tokenAddress: 'C1', deployLedger: null } }),
    );
    expect(dto.metadata).toEqual({ tokenAddress: 'C1' });
  });
});
