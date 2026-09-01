import { describe, it, expect } from 'vitest';
import { HoldingDto, HoldingRow } from '../../../../src/modules/fractionalization/me/dto/holding.dto';

const row: HoldingRow = {
  artworkId: '0000000a-0001-4000-8000-0000000a0001',
  artworkTitle: 'Northern Lights',
  artworkImageUrl: 'https://cdn.tove.test/aw-001.jpg',
  tokenContract: 'C'.repeat(56),
  artistHandle: 'sophie-tove',
  balance: '60',
  lockedBalance: '0',
  freeBalance: '60',
};

describe('HoldingDto.fromRow', () => {
  it('maps fields, keeps decimal-string amounts, and derives the slug', () => {
    const dto = HoldingDto.fromRow(row);
    expect(dto.artworkId).toBe(row.artworkId);
    expect(dto.artworkTitle).toBe('Northern Lights');
    expect(dto.artworkSlug).toBe('northern-lights-0000000a');
    expect(dto.artworkImageUrl).toBe(row.artworkImageUrl);
    expect(dto.tokenContract).toBe(row.tokenContract);
    expect(dto.balance).toBe('60');
    expect(dto.lockedBalance).toBe('0');
    expect(dto.freeBalance).toBe('60');
    expect(dto.artistHandle).toBe('sophie-tove');
  });

  it('preserves null image / handle', () => {
    const dto = HoldingDto.fromRow({ ...row, artworkImageUrl: null, artistHandle: null });
    expect(dto.artworkImageUrl).toBeNull();
    expect(dto.artistHandle).toBeNull();
  });

  it('survives a JSON cache round-trip losslessly (decimal strings)', () => {
    const dto = HoldingDto.fromRow(row);
    expect(JSON.parse(JSON.stringify([dto]))).toEqual([{ ...dto }]);
  });
});
