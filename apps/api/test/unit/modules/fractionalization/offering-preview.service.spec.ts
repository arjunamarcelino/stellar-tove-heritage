import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BackofficeArtworksService } from '@modules/backoffice/artworks/backoffice-artworks.service';
import { OfferingPreviewQueryDto } from '@modules/backoffice/artworks/dto/offering-preview-query.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { MAX_STROOPS } from '@common/constants/stroops.constant';

const ART = '00000000-0000-4000-8000-0000000a0001';

const fc = (over: Record<string, unknown> = {}) => ({
  id: 'fc1',
  artworkId: ART,
  status: 'deployed',
  totalSupply: '1000000',
  artistRetentionAmount: '80000',
  treasuryRetentionAmount: '20000',
  ...over,
});

function build(over: { artwork?: unknown; contract?: unknown } = {}) {
  const artworks = {
    findOneById: vi.fn(() => Promise.resolve('artwork' in over ? over.artwork : { id: ART })),
  };
  const contracts = {
    findActiveByArtworkId: vi.fn(() => Promise.resolve('contract' in over ? over.contract : fc())),
  };
  // Preview is now a method on BackofficeArtworksService; it uses only the artwork + contract repos,
  // so the remaining positional deps (wallets, cfg, idempotency, audit, deployQueue, offerings) are stubbed.
  const service = new BackofficeArtworksService(
    artworks as never,
    contracts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, artworks, contracts };
}

const q = (over: Partial<OfferingPreviewQueryDto> = {}): OfferingPreviewQueryDto =>
  Object.assign(new OfferingPreviewQueryDto(), over);

async function expectHttp(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await p.then(
    () => {
      throw new Error('expected the preview to reject');
    },
    (err: unknown) => {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(status);
      expect((e.getResponse() as { errorCode?: string }).errorCode).toBe(code);
    },
  );
}

describe('BackofficeArtworksService.offeringPreview', () => {
  it('band supplied → publicFloat + estimated raise range (positive)', async () => {
    const { service } = build();
    const res = await service.offeringPreview(
      ART,
      q({ low_price_stroops: '50000000', high_price_stroops: '150000000' }),
    );
    expect(res).toEqual({
      publicFloat: '900000', // 1_000_000 − 80_000 − 20_000
      totalSupply: '1000000',
      artistRetentionAmount: '80000',
      treasuryRetentionAmount: '20000',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      estimatedRaiseLow: String(50000000n * 900000n),
      estimatedRaiseHigh: String(150000000n * 900000n),
    });
  });

  it('no band → float + components only, no estimatedRaise* keys (positive/edge)', async () => {
    const { service } = build();
    const res = await service.offeringPreview(ART, q());
    expect(res).toEqual({
      publicFloat: '900000',
      totalSupply: '1000000',
      artistRetentionAmount: '80000',
      treasuryRetentionAmount: '20000',
    });
    expect(res.estimatedRaiseLow).toBeUndefined();
    expect(res.lowPriceStroops).toBeUndefined();
  });

  it('unknown artwork → 404 ARTWORK_NOT_FOUND (negative)', async () => {
    const { service } = build({ artwork: null });
    await expectHttp(service.offeringPreview(ART, q()), 404, ErrorCode.ARTWORK_NOT_FOUND);
  });

  it.each([
    ['deploying contract', fc({ status: 'deploying' })],
    ['deployed but null retention amounts', fc({ artistRetentionAmount: null })],
    ['no active contract', null],
  ])('%s → 409 OFFERING_ARTWORK_NOT_FRACTIONALIZED (negative)', async (_label, contract) => {
    const { service } = build({ contract });
    await expectHttp(service.offeringPreview(ART, q()), 409, ErrorCode.OFFERING_ARTWORK_NOT_FRACTIONALIZED);
  });

  it('retentions consume the supply → 422 OFFERING_NO_FLOAT (edge)', async () => {
    const { service } = build({
      contract: fc({ totalSupply: '100000', artistRetentionAmount: '100000', treasuryRetentionAmount: '0' }),
    });
    await expectHttp(service.offeringPreview(ART, q()), 422, ErrorCode.OFFERING_NO_FLOAT);
  });

  // (An invalid band low>=high → 422 is covered by the precedence test below, which asserts the same
  // 422 OFFERING_BAND_INVALID for a low>=high band; the standalone case was redundant — see todo 280.)
  it('precedence: invalid band is checked BEFORE artwork existence (422 not 404) — POST parity', async () => {
    const { service, artworks } = build({ artwork: null });
    await expectHttp(
      service.offeringPreview(ART, q({ low_price_stroops: '150', high_price_stroops: '50' })),
      422,
      ErrorCode.OFFERING_BAND_INVALID,
    );
    expect(artworks.findOneById).not.toHaveBeenCalled(); // rejected before touching the DB
  });

  it('estimatedRaise stays an exact BigInt decimal string at max band × large float (edge)', async () => {
    const bigFloat = '1000000000000000000000000000000000000'; // 1e36
    const { service } = build({
      contract: fc({ totalSupply: bigFloat, artistRetentionAmount: '0', treasuryRetentionAmount: '0' }),
    });
    const res = await service.offeringPreview(
      ART,
      q({ low_price_stroops: '1', high_price_stroops: MAX_STROOPS.toString() }),
    );
    expect(res.estimatedRaiseHigh).toBe(String(MAX_STROOPS * BigInt(bigFloat)));
    expect(res.estimatedRaiseHigh).not.toMatch(/[eE.]/); // no scientific notation / decimal point
  });
});
