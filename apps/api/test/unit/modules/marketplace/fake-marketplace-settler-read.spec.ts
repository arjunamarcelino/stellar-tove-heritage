import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FakeMarketplaceSettlerRead } from '../../../shared/fake-marketplace-settler-read';
import { MarketplaceSettlerReadUnavailableError } from '@modules/marketplace/settlement/marketplace-settler-read.service.interface';

/**
 * The `MARKETPLACE_SETTLER_READ_SERVICE` contract the settle worker relies on: a genuine `false` for an
 * unknown pair, `true` once settled, and a THROW (never a coerced `false`) on an unavailable read.
 */
describe('FakeMarketplaceSettlerRead (is_settled oracle contract)', () => {
  it('reads false for an unknown pair, true once marked settled', async () => {
    const read = new FakeMarketplaceSettlerRead();
    const rfq = randomUUID();
    const quote = randomUUID();
    expect(await read.isSettled(rfq, quote)).toBe(false);
    read.markSettled(rfq, quote);
    expect(await read.isSettled(rfq, quote)).toBe(true);
    // A different quote on the same rfq is independent.
    expect(await read.isSettled(rfq, randomUUID())).toBe(false);
  });

  it('THROWS on an unavailable read (never coerces to false)', async () => {
    const read = new FakeMarketplaceSettlerRead();
    read.failNext();
    await expect(read.isSettled(randomUUID(), randomUUID())).rejects.toBeInstanceOf(
      MarketplaceSettlerReadUnavailableError,
    );
    // Recovers on the next call.
    expect(await read.isSettled(randomUUID(), randomUUID())).toBe(false);
  });
});
