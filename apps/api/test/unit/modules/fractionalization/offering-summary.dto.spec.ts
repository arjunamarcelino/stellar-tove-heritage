import { describe, it, expect } from 'vitest';
import { OfferingSummaryDto } from '@modules/backoffice/artworks/dto/offering-summary.dto';
import { Offering } from '@modules/offerings/entities/offering.entity';

describe('OfferingSummaryDto.fromEntity', () => {
  it('maps every field; money stays a string; windows → ISO (positive)', () => {
    const dto = OfferingSummaryDto.fromEntity({
      id: 'off1',
      status: 'planned',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      publicFloat: '900000',
      windowOpenAt: new Date('2026-09-01T00:00:00.000Z'),
      windowCloseAt: new Date('2026-09-08T00:00:00.000Z'),
    } as Offering);

    expect(dto).toEqual({
      id: 'off1',
      status: 'planned',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      publicFloat: '900000',
      windowOpenAt: '2026-09-01T00:00:00.000Z',
      windowCloseAt: '2026-09-08T00:00:00.000Z',
    });
    expect(typeof dto.publicFloat).toBe('string');
  });
});
